import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import ModuleType, SimpleNamespace

import httpx
from src.models import ContentItem, SourceType, SourcesConfig
from bridge import Outbox, SCRAPERS, SourceUnavailable, collect, jobs, normalize, validate_config
from safe_http import PublicTransport


def story(kind=SourceType.TELEGRAM, **changes):
    data = dict(id=f'{kind.value}:test:1', source_type=kind, title='Python API', url='https://example.com/article', content='Texto original\n--- Top Comments ---\n[alice]: Comentario', published_at=datetime.now(timezone.utc), metadata={'msg_url': 'https://t.me/channel/1'})
    data.update(changes)
    return ContentItem(**data)


class BridgeTests(unittest.TestCase):
    def test_unconfigured_optional_source_does_not_stop_other_sources(self):
        class Good:
            async def fetch(self, since):
                return [story()]
        async def run():
            def factory(config, client):
                yield 'twitter', 'twitter', SourceUnavailable('missing_apify_credential')
                yield 'telegram', 'telegram:test', Good()
            items, report = await collect(None, datetime.now(timezone.utc), factory=factory, transport=httpx.MockTransport(lambda request: httpx.Response(200)))
            self.assertEqual(len(items), 1)
            self.assertEqual(report[0]['error'], 'missing_apify_credential')
            self.assertEqual(report[1]['status'], 'success')
        asyncio.run(run())
    def test_actual_horizon_models_and_all_ten_scraper_constructors(self):
        config = SourcesConfig.model_validate(json.loads(Path('services/horizon_bridge/sources.example.json').read_text(encoding='utf-8'))['sources'])
        with httpx.Client():
            self.assertEqual(len(SCRAPERS), 10)
        async def run():
            async with httpx.AsyncClient() as client:
                configured = list(jobs(config, client))
                self.assertEqual({kind for kind, _, _ in configured}, {'rss', 'hackernews', 'ossinsight', 'gdelt', 'google_news'})
                raw = config.model_dump(mode='json')
                raw['github'] = [{'type': 'repo_releases', 'owner': 'python', 'repo': 'cpython'}]
                raw['reddit'] = {'enabled': True, 'subreddits': [{'subreddit': 'test'}]}
                raw['telegram'] = {'enabled': True, 'channels': [{'channel': 'test'}]}
                raw['twitter'] = {'enabled': True, 'users': ['test'], 'mode': 'apify'}
                raw['openbb'] = {'enabled': True, 'watchlists': [{'name': 'test', 'symbols': ['TEST']} ]}
                fake_openbb = ModuleType('openbb')
                fake_openbb.obb = SimpleNamespace()
                with patch.dict('os.environ', {'APIFY_TOKEN': 'fixture'}), patch.dict('sys.modules', {'openbb': fake_openbb}), patch('bridge.importlib.util.find_spec', return_value=True):
                    configured = list(jobs(SourcesConfig.model_validate(raw), client))
                self.assertEqual({kind for kind, _, _ in configured}, set(SCRAPERS))
        asyncio.run(run())

    def test_unknown_configuration_field_is_not_silently_ignored(self):
        raw = json.loads(Path('services/horizon_bridge/sources.example.json').read_text(encoding='utf-8'))
        raw['sources']['hackernews']['fetch_top_stroies'] = 50
        with self.assertRaises(ValueError):
            validate_config(raw)

    def test_social_permalink_and_discussion_are_not_article_body(self):
        result = normalize(story(), 'telegram:channel')
        self.assertEqual(result['sourceUrl'], 'https://t.me/channel/1')
        self.assertIsNone(result['targetUrl'])
        self.assertNotIn('Comentario', result['nativeText'])
        self.assertEqual(result['comments'], ['[alice]: Comentario'])
        hn = normalize(story(SourceType.HACKERNEWS, metadata={'discussion_url': 'https://news.ycombinator.com/item?id=1'}), 'hn')
        self.assertEqual(hn['targetUrl'], 'https://example.com/article')
        self.assertEqual(hn['contentKind'], 'article')

    def test_retry_after_lost_ack_and_restart_keeps_same_batch(self):
        async def run():
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'outbox.sqlite'
                box = Outbox(path)
                box.enqueue([normalize(story(), 'telegram:channel')])
                original = box.db.execute('SELECT id FROM outbox').fetchone()[0]
                async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(503))) as client:
                    with self.assertRaises(httpx.HTTPStatusError):
                        await box.flush(client, 'http://andes:8788', 'x' * 32)
                box.db.close()
                box = Outbox(path)
                self.assertEqual(box.db.execute('SELECT id FROM outbox').fetchone()[0], original)
                def ack(request):
                    body = json.loads(request.content)
                    self.assertEqual(body['batchId'], original)
                    return httpx.Response(200, json={'batchId': original, 'results': [{'index': 0, 'status': 'duplicate'}]})
                async with httpx.AsyncClient(transport=httpx.MockTransport(ack)) as client:
                    await box.flush(client, 'http://andes:8788', 'x' * 32)
                self.assertEqual(box.db.execute('SELECT count(*) FROM outbox').fetchone()[0], 0)
                box.db.close()
        asyncio.run(run())

    def test_unicode_lots_stay_below_http_body_limit(self):
        box = Outbox(':memory:')
        try:
            item = normalize(story(content='界' * 32000), 'telegram:test')
            box.enqueue([item] * 50)
            for (raw,) in box.db.execute('SELECT body FROM outbox'):
                self.assertLess(len(raw.encode()), 2_000_000)
                self.assertLessEqual(len(json.loads(raw)['items']), 50)
        finally:
            box.db.close()

    def test_transport_rejects_private_dns_and_pins_public_connection(self):
        async def run():
            calls = []
            async def resolver(host, port):
                return ['127.0.0.1'] if host == 'unsafe.example' else ['93.184.216.34']
            def respond(request):
                calls.append(request)
                return httpx.Response(200, text='{"ok":true}')
            transport = PublicTransport(inner=httpx.MockTransport(respond), resolver=resolver)
            async with httpx.AsyncClient(transport=transport) as client:
                with self.assertRaises(ValueError):
                    await client.get('http://unsafe.example/')
                await client.get('https://api.github.com/example')
            self.assertEqual(calls[-1].url.host, '93.184.216.34')
            self.assertEqual(calls[-1].headers['host'], 'api.github.com')
            self.assertEqual(calls[-1].extensions['sni_hostname'], 'api.github.com')
        asyncio.run(run())

    def test_actual_horizon_hn_fetch_preserves_comment_provenance(self):
        from src.scrapers.hackernews import HackerNewsScraper
        from src.models import HackerNewsConfig
        async def run():
            def respond(request):
                if request.url.path.endswith('topstories.json'):
                    data = [1]
                elif request.url.path.endswith('/1.json'):
                    data = {'id': 1, 'type': 'story', 'title': 'Python API', 'url': 'https://example.com/a', 'by': 'author', 'time': int(datetime.now(timezone.utc).timestamp()), 'score': 20, 'kids': [2]}
                else:
                    data = {'id': 2, 'text': '<p>Technical comment</p>', 'by': 'reviewer'}
                return httpx.Response(200, json=data)
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                scraper = HackerNewsScraper(HackerNewsConfig(min_score=0), client)
                result = await scraper.fetch(datetime(2020, 1, 1, tzinfo=timezone.utc))
            item = normalize(result[0], 'hackernews')
            self.assertIn('reviewer', item['comments'][0])
            self.assertEqual(item['nativeText'], '')
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
