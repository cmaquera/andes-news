"""Capture with pinned Horizon scrapers; durable delivery to Andes, no LLM calls."""
import argparse
import asyncio
import hashlib
import importlib
import json
import logging
import os
from pathlib import Path
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from html import unescape
from urllib.parse import urlsplit
import uuid

import httpx
from bs4 import BeautifulSoup
from src.models import SourcesConfig
from safe_http import PublicTransport

HORIZON_REVISION = "8f5446bf45c2d7763d17423d97d17906add85da1"
SCRAPERS = {
    "hackernews": ("hackernews", "HackerNewsScraper"),
    "rss": ("rss", "RSSScraper"),
    "reddit": ("reddit", "RedditScraper"),
    "telegram": ("telegram", "TelegramScraper"),
    "twitter": ("twitter", "TwitterScraper"),
    "github": ("github", "GitHubScraper"),
    "openbb": ("openbb", "OpenBBScraper"),
    "ossinsight": ("ossinsight", "OSSInsightScraper"),
    "gdelt": ("gdelt", "GDELTScraper"),
    "google_news": ("google_news", "GoogleNewsScraper"),
}


class SourceUnavailable:
    def __init__(self, code):
        self.code = code

    async def fetch(self, since):
        error = RuntimeError(self.code)
        error.code = self.code
        raise error


def validate_config(raw):
    if set(raw) != {'sources'} or set(raw['sources']) != set(SCRAPERS):
        raise ValueError('Configuration must explicitly declare the ten source types')
    parsed = SourcesConfig.model_validate(raw['sources'])
    def check(original, model):
        if isinstance(original, dict) and hasattr(type(model), 'model_fields'):
            if set(original) - set(type(model).model_fields):
                raise ValueError('Unknown source configuration field')
            for key, value in original.items():
                check(value, getattr(model, key))
        elif isinstance(original, list) and isinstance(model, list):
            for left, right in zip(original, model):
                check(left, right)
    check(raw['sources'], parsed)
    return parsed


def plain(value):
    return unescape(BeautifulSoup(str(value or ""), "html.parser").get_text(" ", strip=True))


def normalize(item, instance, feed_url=None):
    kind = item.source_type.value
    meta = item.metadata
    url = str(item.url)
    source_url = meta.get("discussion_url") or meta.get("msg_url") or url
    body, marker, comments = (item.content or "").partition("--- Top Comments ---")
    native = kind in {"twitter", "telegram", "ossinsight"} or (kind == "reddit" and meta.get("is_self")) or (kind == "hackernews" and url == source_url)
    content_kind = "social_post" if native else "article"
    if kind == "github":
        content_kind = "release" if ":release:" in item.id or meta.get("event_type") == "ReleaseEvent" else "repository"
        # Events sharing a repository URL are distinct source documents.
        if ":event:" in item.id:
            source_url = f"{url}?andes_event={item.id.rsplit(':', 1)[-1]}"
            url = source_url
    if kind == "ossinsight":
        content_kind = "repository"
    source_key = hashlib.sha256(instance.encode()).hexdigest()[:24]
    return {
        "sourceInstanceId": f"{kind}:{source_key}", "sourceType": kind,
        "sourceName": instance[:200],
        **({"sourceFeedUrl": str(feed_url)} if feed_url else {}),
        "externalId": hashlib.sha256(item.id.encode()).hexdigest(),
        "contentKind": content_kind,
        # Social content is identified by its permalink, never an incidental link.
        "sourceUrl": source_url, "targetUrl": None if content_kind != "article" else url,
        "title": plain(item.title)[:1000] or "Publicación sin título",
        "nativeText": (body if kind == 'github' else plain(body))[:32000], "author": plain(item.author)[:200],
        "publishedAt": item.published_at.astimezone(timezone.utc).isoformat(),
        "fetchedAt": item.fetched_at.astimezone(timezone.utc).isoformat(),
        "comments": [plain(c)[:2000] for c in comments.splitlines() if c.strip()][:10] if marker else [],
        "engagement": {
            "score": max(0, int(meta.get("score") or meta.get("favorite_count") or meta.get("stars_gained") or 0)),
            "comments": max(0, int(meta.get("num_comments") or meta.get("descendants") or meta.get("reply_count") or 0)),
        },
    }


class Outbox:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.executescript("""CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,body TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS rejected(id TEXT PRIMARY KEY,body TEXT NOT NULL,result TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);""")

    def enqueue(self, items):
        groups, group, size = [], [], 0
        for item in items:
            length = len(json.dumps(item).encode('utf-8'))
            if group and (len(group) == 50 or size + length > 1_800_000):
                groups.append(group)
                group, size = [], 0
            group.append(item)
            size += length
        if group:
            groups.append(group)
        for group in groups:
            batch = {"schemaVersion": 1, "batchId": str(uuid.uuid4()), "producerRevision": HORIZON_REVISION, "items": group}
            self.db.execute("INSERT INTO outbox VALUES(?,?)", (batch["batchId"], json.dumps(batch)))
        self.db.commit()

    def status(self, value):
        self.db.execute("INSERT OR REPLACE INTO state VALUES('last_run',?)", (json.dumps(value),))
        self.db.commit()

    async def flush(self, client, endpoint, token):
        for batch_id, raw in self.db.execute("SELECT id,body FROM outbox ORDER BY rowid").fetchall():
            response = await client.post(f"{endpoint.rstrip('/')}/batches", content=raw.encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
            response.raise_for_status()
            result = response.json()
            rows = result.get("results", [])
            expected = len(json.loads(raw)["items"])
            if result.get("batchId") != batch_id or len(rows) != expected or {r.get("index") for r in rows} != set(range(expected)) or any(r.get("status") not in {"accepted", "duplicate", "rejected"} for r in rows):
                raise ValueError("incomplete_ingestion_ack")
            if any(r["status"] == "rejected" for r in rows):
                self.db.execute("INSERT OR REPLACE INTO rejected VALUES(?,?,?)", (batch_id, raw, json.dumps(result)))
            self.db.execute("DELETE FROM outbox WHERE id=?", (batch_id,))
            self.db.commit()


def jobs(config, client):
    """One named source instance per job; keep failures independent."""
    for kind, (module, name) in SCRAPERS.items():
        value = getattr(config, kind)
        cls = getattr(importlib.import_module(f"src.scrapers.{module}"), name)
        if kind in {"rss", "github"}:
            for entry in value:
                if entry.enabled:
                    identity = f"{entry.name}:{hashlib.sha256(str(entry.url).encode()).hexdigest()[:12]}" if kind == "rss" else f"{entry.type}:{entry.username or entry.owner}:{entry.repo or ''}"
                    scraper = cls([entry], client)
                    if kind == "rss":
                        scraper.andes_feed_url = str(entry.url)
                    yield kind, f"{kind}:{identity}", scraper
        elif value and value.enabled:
            if kind == "twitter":
                if value.mode != "apify":
                    yield kind, kind, SourceUnavailable('twitter_requires_apify_mode')
                    continue
                if not value.users and not value.keywords:
                    continue
                if not os.environ.get(value.apify_token_env):
                    yield kind, kind, SourceUnavailable('missing_apify_credential')
                    continue
            if kind == "openbb":
                if not any(w.enabled and w.symbols for w in value.watchlists):
                    continue
                if importlib.util.find_spec("openbb") is None:
                    yield kind, kind, SourceUnavailable('missing_openbb_dependencies')
                    continue
            entries = []
            if kind == "telegram":
                entries = [("channels", c, c.channel) for c in value.channels if c.enabled]
            elif kind == "reddit":
                entries = [("subreddits", c, f"r/{c.subreddit}") for c in value.subreddits if c.enabled] + [("users", c, f"u/{c.username}") for c in value.users if c.enabled]
            if kind in {"reddit", "telegram"}:
                for field, entry, identity in entries:
                    changes = {"subreddits": [], "users": []} if kind == "reddit" else {"channels": []}
                    changes[field] = [entry]
                    yield kind, f"{kind}:{identity}", cls(value.model_copy(update=changes), client)
            else:
                yield kind, kind, cls(value, client)


async def collect(config, since, factory=jobs, transport=None):
    items, report = [], []
    async with httpx.AsyncClient(transport=transport or PublicTransport(), timeout=30, follow_redirects=True, max_redirects=5, trust_env=False) as client:
        for kind, identity, scraper in factory(config, client):
            before = getattr(client._transport, "failures", 0)
            reasons_before = len(getattr(client._transport, 'failure_reasons', []))
            try:
                entries = await asyncio.wait_for(scraper.fetch(since), timeout=900)
                if kind == "twitter" and scraper.config.fetch_reply_text:
                    for entry in entries[:scraper.config.max_tweets_to_expand]:
                        replies = await scraper.fetch_replies_for_item(entry)
                        scraper.append_discussion_content(entry, replies)
                for entry in entries[:100]:
                    try:
                        items.append(normalize(entry, identity, getattr(scraper, 'andes_feed_url', None)))
                    except (ValueError, TypeError):
                        report.append({"source": identity, "status": "invalid_item"})
                failed = getattr(client._transport, "failures", 0) > before
                report.append({"source": identity, "status": "partial_failure" if failed else "success" if entries else "empty", "count": len(entries), 'errors': sorted(set(getattr(client._transport, 'failure_reasons', [])[reasons_before:]))})
            except Exception as error:
                # Never log exception URLs: Apify embeds its token in query strings.
                report.append({"source": identity, "status": "failure", "error": getattr(error, 'code', type(error).__name__)})
    return items, report


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--probe", action="store_true", help='Fetch and report counts only; do not deliver or publish')
    parser.add_argument("--source", choices=list(SCRAPERS))
    args = parser.parse_args()
    for module in ("src", "httpx", "httpcore"):
        logging.getLogger(module).setLevel(logging.CRITICAL)
    config_path = Path(os.environ.get("HORIZON_CONFIG", "/config/sources.json"))
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    config = validate_config(raw)
    if args.validate:
        print(json.dumps({"valid": True, "sourceTypes": list(SCRAPERS), "horizonRevision": HORIZON_REVISION}))
        return
    if args.probe:
        selected = lambda config, client: (job for job in jobs(config, client) if not args.source or job[0] == args.source)
        entries, report = await collect(config, datetime.now(timezone.utc) - timedelta(hours=24), factory=selected)
        print(json.dumps({'captured': len(entries), 'sources': report, 'delivered': False}), flush=True)
        return
    token = os.environ.get("ANDES_INGESTION_TOKEN", "")
    if len(token) < 32:
        raise ValueError("Set ANDES_INGESTION_TOKEN, at least 32 characters")
    endpoint = os.environ.get("ANDES_INGESTION_URL", "http://andes-api:8788")
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Invalid ANDES_INGESTION_URL")
    data = Path(os.environ.get("BRIDGE_DATA", "/data"))
    data.mkdir(parents=True, exist_ok=True)
    outbox = Outbox(data / "outbox.sqlite")
    delay = 30
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False, trust_env=False) as delivery:
            while True:
                try:
                    await outbox.flush(delivery, endpoint, token)
                    since = datetime.now(timezone.utc) - timedelta(hours=24)
                    entries, report = await collect(config, since)
                    outbox.enqueue(entries)
                    outbox.status({"at": datetime.now(timezone.utc).isoformat(), "sources": report, "captured": len(entries)})
                    print(json.dumps({"captured": len(entries), "sources": report}), flush=True)
                    await outbox.flush(delivery, endpoint, token)
                    delay = 30
                    if args.once:
                        break
                    await asyncio.sleep(7200)
                except Exception as error:
                    print(json.dumps({"status": "retry", "error": type(error).__name__, "retrySeconds": delay}), flush=True)
                    if args.once:
                        raise
                    await asyncio.sleep(delay)
                    delay = min(1800, delay * 2)
    finally:
        outbox.db.close()


if __name__ == "__main__":
    asyncio.run(main())
