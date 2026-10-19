import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { publicUrl } from '../services/public_http.mjs';
import { assessFocus, FOCUS_VERSION } from '../services/focus.mjs';
import { sourceIdentity, sourceCatalog } from '../services/source_identity.mjs';
import { arxivIdentity } from '../services/arxiv.mjs';
export function canonicalUrl(value) {
  const url = publicUrl(value);
  const paper = arxivIdentity(url.href);
  if (paper) return paper.abstractUrl;
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith('utm_') || key === 'fbclid') url.searchParams.delete(key);
  return url.href;
}
export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,data TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0,discovered INTEGER NOT NULL,updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS model_cache(key TEXT PRIMARY KEY,result TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS ingestion_batches(id TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS source_occurrences(source TEXT NOT NULL,external_id TEXT NOT NULL,article_id TEXT,data TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(source,external_id));
      CREATE INDEX IF NOT EXISTS occurrences_article ON source_occurrences(article_id);
      CREATE TABLE IF NOT EXISTS editorial_decisions(article_id TEXT PRIMARY KEY,data TEXT NOT NULL,updated INTEGER NOT NULL);`);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS publication_events(article_id TEXT PRIMARY KEY,day TEXT NOT NULL,published_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS publication_day ON publication_events(day);',
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS articles_duplicate ON articles(json_extract(data,'$.duplicateOf'));",
    );
    this.db
      .prepare(
        "UPDATE articles SET state='queued',data=json_set(data,'$.status','queued') WHERE state='processing'",
      )
      .run();
    // Upgrade existing text-only articles once, preserving their readable body
    // and abstract while the worker retrieves rich content in the background.
    this.db
      .prepare(
        "UPDATE articles SET state='queued',attempts=0,retry_at=0,data=json_set(data,'$.status','queued','$.needsRichExtraction',json('true'),'$.richUpgradeScheduled',json('true')) WHERE json_extract(data,'$.contentText')<>'' AND COALESCE(json_extract(data,'$.extractionVersion'),0)<2 AND COALESCE(json_extract(data,'$.richUpgradeScheduled'),0)=0",
      )
      .run();
    // Reassess previously collected stories on upgrade, retaining them for
    // saved-article detail while removing irrelevant stories from feed/worker.
    if (this.getMeta('focusVersion') !== FOCUS_VERSION) {
      this.db.exec('BEGIN');
      try {
        for (const row of this.db.prepare('SELECT data,state FROM articles').all()) {
          const article = JSON.parse(row.data),
            relevance = assessFocus(article, { full: Boolean(article.contentText) });
          this.save(
            { ...article, relevance, topic: relevance.topic },
            relevance.accepted ? (row.state === 'filtered' ? 'queued' : row.state) : 'filtered',
          );
        }
        this.setMeta('focusVersion', FOCUS_VERSION);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }
  discover(candidate) {
    const url = canonicalUrl(candidate.url),
      id = createHash('sha256').update(url).digest('hex').slice(0, 32),
      now = Date.now();
    const previous = this.get(id);
    if (previous) return { article: previous, isNew: false };
    const relevance = candidate.relevance ?? assessFocus(candidate),
      state = relevance.accepted ? 'queued' : 'filtered';
    const data = {
      ...candidate,
      relevance,
      topic: relevance.topic,
      id,
      url,
      status: state,
      coverage: 'unavailable',
      content: [],
      translatedContent: [],
      contentText: '',
      abstract: '',
      titleEs: '',
      keyPoints: [],
      discoveredAt: new Date(now).toISOString(),
    };
    this.db
      .prepare('INSERT INTO articles(id,url,data,state,discovered,updated) VALUES(?,?,?,?,?,?)')
      .run(id, url, JSON.stringify(data), state, now, now);
    return { article: data, isNew: true };
  }
  get(id) {
    const row = this.db.prepare('SELECT data FROM articles WHERE id=?').get(id);
    return row ? this.withOccurrences(JSON.parse(row.data)) : null;
  }
  save(article, state = article.status) {
    this.db
      .prepare('UPDATE articles SET data=?,state=?,updated=? WHERE id=?')
      .run(JSON.stringify({ ...article, status: state }), state, Date.now(), article.id);
  }
  next() {
    const row = this.db
      .prepare(
        "SELECT data FROM articles WHERE state='queued' AND retry_at<=? ORDER BY discovered,id LIMIT 1",
      )
      .get(Date.now());
    return row ? JSON.parse(row.data) : null;
  }
  fail(article, code) {
    const row = this.db.prepare('SELECT attempts FROM articles WHERE id=?').get(article.id),
      attempts = (row?.attempts ?? 0) + 1;
    const state = attempts >= 3 ? 'unavailable' : 'queued';
    const data = { ...article, status: state, lastError: code };
    this.db
      .prepare('UPDATE articles SET data=?,state=?,attempts=?,retry_at=?,updated=? WHERE id=?')
      .run(JSON.stringify(data), state, attempts, Date.now() + 7200000, Date.now(), article.id);
  }
  list({ limit = 100, offset = 0, editorial = false } = {}) {
    return this.db
      .prepare(
        `SELECT data FROM articles WHERE state<>'filtered' AND json_extract(data,'$.relevance.accepted')=1 AND COALESCE(json_extract(data,'$.ingestionShadow'),0)=0 ${editorial ? "AND state='ready' AND json_extract(data,'$.editorialStatus')='accepted'" : ''} ORDER BY date(json_extract(data,'$.published'),'-5 hours') DESC, ${editorial ? "json_extract(data,'$.editorialScore') DESC," : ''} json_extract(data,'$.relevance.priority') DESC, CASE json_extract(data,'$.region') WHEN 'Perú' THEN 0 WHEN 'Latinoamérica' THEN 1 ELSE 2 END,json_extract(data,'$.published') DESC,discovered DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset)
      .map((row) => {
        const a = JSON.parse(row.data);
        delete a.content;
        delete a.translatedContent;
        delete a.contentText;
        delete a.nativeText;
        return this.withOccurrences(a);
      });
  }
  withOccurrences(article) {
    const rows = this.db
      .prepare(
        "SELECT data FROM source_occurrences WHERE article_id=? OR article_id IN (SELECT id FROM articles WHERE json_extract(data,'$.duplicateOf')=?) ORDER BY source,external_id",
      )
      .all(article.id, article.id);
    return {
      ...article,
      sourceId: sourceIdentity(article).id,
      sourceName: sourceIdentity(article).name,
      sourceOccurrences: rows.map((r) => {
        const item = JSON.parse(r.data);
        const source = sourceIdentity(item);
        return {
          sourceId: source.id,
          sourceName: source.name,
          sourceType: item.sourceType,
          ingestionProducer: 'horizon',
          sourceInstanceId: item.sourceInstanceId,
          sourceUrl: item.sourceUrl,
          comments: item.comments ?? [],
        };
      }),
    };
  }
  batch(id) {
    const row = this.db.prepare('SELECT digest,result FROM ingestion_batches WHERE id=?').get(id);
    return row ? { digest: row.digest, result: JSON.parse(row.result) } : null;
  }
  ingestBatch(batch, digest, items, results, mode) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of items) {
        const identity = sourceIdentity(item),
          sourceId = identity.id;
        const previous = this.db
          .prepare(
            'SELECT article_id,data FROM source_occurrences WHERE source=? AND external_id=?',
          )
          .get(item.sourceInstanceId, item.externalId);
        const candidate = {
          title: item.title,
          url: item.url,
          sourceId,
          sourceName: identity.name,
          sourceFeedUrl: item.sourceFeedUrl,
          sourceType: item.sourceType,
          ingestionProducer: 'horizon',
          sourceInstanceId: item.sourceInstanceId,
          sourceUrl: item.sourceUrl,
          contentKind: item.contentKind,
          nativeText: item.nativeText ?? '',
          author: item.author ?? '',
          languageHint: item.languageHint ?? '',
          published: new Date(item.publishedAt).toISOString(),
          feedExcerpt: (item.nativeText ?? '').slice(0, 500),
          region: 'Global',
          score: item.engagement?.score ?? 0,
          comments: item.engagement?.comments ?? 0,
          ingestionShadow: mode === 'shadow',
        };
        // All candidates reach the worker so shadow/AI evaluation sees rule negatives.
        candidate.relevance = {
          ...assessFocus(candidate),
          accepted: true,
          reason: 'pending_editorial',
        };
        const found = previous?.article_id
          ? { article: this.get(previous.article_id), isNew: false }
          : this.discover(candidate);
        if (!found.article) throw Error('occurrence_article_missing');
        if (
          previous &&
          item.contentKind !== 'article' &&
          JSON.parse(previous.data).nativeText !== item.nativeText &&
          found.article.sourceId === sourceId
        ) {
          found.article = {
            ...found.article,
            title: candidate.title,
            nativeText: candidate.nativeText,
            contentText: '',
            content: [],
            translatedContent: [],
            abstract: '',
            titleEs: '',
            keyPoints: [],
            editorialStatus: 'pending',
            editorialReviewed: false,
          };
          this.save(found.article, 'queued');
          found.article.status = 'queued';
          this.db
            .prepare('UPDATE articles SET attempts=0,retry_at=0 WHERE id=?')
            .run(found.article.id);
        }
        // Explicit replay in active mode promotes shadow data without changing IDs.
        if (mode === 'active' && found.article.ingestionShadow) {
          const article = found.article;
          this.save(
            { ...article, ingestionShadow: false },
            ['filtered', 'unavailable'].includes(article.status) ? 'queued' : article.status,
          );
        }
        const occurrence = { ...item, sourceId, sourceName: candidate.sourceName };
        this.db
          .prepare(
            'INSERT INTO source_occurrences(source,external_id,article_id,data,updated) VALUES(?,?,?,?,?) ON CONFLICT(source,external_id) DO UPDATE SET data=excluded.data,updated=excluded.updated',
          )
          .run(
            item.sourceInstanceId,
            item.externalId,
            found.article.id,
            JSON.stringify(occurrence),
            Date.now(),
          );
        results[item.index].status = found.isNew ? 'accepted' : 'duplicate';
        results[item.index].articleId = found.article.id;
      }
      const result = { batchId: batch.batchId, results };
      this.db
        .prepare('INSERT INTO ingestion_batches VALUES(?,?,?,?)')
        .run(batch.batchId, digest, JSON.stringify(result), Date.now());
      this.setMeta('ingestion', {
        lastBatchAt: new Date().toISOString(),
        batchId: batch.batchId,
        mode,
        results: results.map((r) => r.status),
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  sourceCatalog() {
    return sourceCatalog(
      this.db
        .prepare(
          "SELECT data FROM source_occurrences WHERE article_id IN (SELECT id FROM articles WHERE COALESCE(json_extract(data,'$.ingestionShadow'),0)=0)",
        )
        .all()
        .map((r) => JSON.parse(r.data)),
      false,
    );
  }
  publishPilot(id, { day, at, limit }) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare("SELECT data FROM articles WHERE id=? AND state='ready'").get(id);
      const article = row ? JSON.parse(row.data) : null;
      const count = this.db
        .prepare('SELECT count(*) AS count FROM publication_events WHERE day=?')
        .get(day).count;
      const previous = this.db
        .prepare('SELECT article_id FROM publication_events WHERE article_id=?')
        .get(id);
      if (!article?.ingestionShadow || count >= limit || previous) {
        this.db.exec('ROLLBACK');
        return false;
      }
      this.save(
        {
          ...article,
          ingestionShadow: false,
          publicationKind: 'pilot_auto',
          publishedToFeedAt: new Date(at).toISOString(),
          selectionReasons: ['Selección automática de prueba', ...(article.selectionReasons ?? [])],
        },
        'ready',
      );
      this.db.prepare('INSERT INTO publication_events VALUES(?,?,?)').run(id, day, at);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  pilotStatus(day) {
    return {
      automaticToday: this.db
        .prepare('SELECT count(*) AS count FROM publication_events WHERE day=?')
        .get(day).count,
      lastAutomaticAt: this.db
        .prepare('SELECT max(published_at) AS at FROM publication_events')
        .get().at,
    };
  }
  hideShadowNegatives() {
    this.db.exec(
      "UPDATE articles SET data=json_set(data,'$.ingestionShadow',json('true')) WHERE state IN ('queued','processing') AND json_extract(data,'$.relevance.reason') IN ('outside_focus','consumer_technology','general_interest','ai_without_concrete_advance') AND COALESCE(json_extract(data,'$.editorialReviewed'),0)=0",
    );
  }
  recordDecision(id, decision) {
    this.db
      .prepare('INSERT OR REPLACE INTO editorial_decisions VALUES(?,?,?)')
      .run(id, JSON.stringify(decision), Date.now());
  }
  decisions() {
    return this.db
      .prepare('SELECT article_id,data FROM editorial_decisions ORDER BY updated DESC LIMIT 1000')
      .all()
      .map((r) => ({ articleId: r.article_id, ...JSON.parse(r.data) }));
  }
  recentPrepared(id) {
    return this.db
      .prepare(
        "SELECT data FROM articles WHERE id<>? AND state='ready' AND json_extract(data,'$.relevance.accepted')=1 AND COALESCE(json_extract(data,'$.ingestionShadow'),0)=0 AND updated>? ORDER BY updated DESC LIMIT 100",
      )
      .all(id, Date.now() - 72 * 3600000)
      .map((r) => JSON.parse(r.data));
  }
  findContentDuplicate(article) {
    const text = (article.contentText ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 200) return null;
    return (
      this.recentPrepared(article.id).find(
        (x) => (x.contentText ?? '').replace(/\s+/g, ' ').trim() === text,
      ) ?? null
    );
  }
  counts() {
    return Object.fromEntries(
      this.db
        .prepare('SELECT state,count(*) AS count FROM articles GROUP BY state')
        .all()
        .map((r) => [r.state, r.count]),
    );
  }
  getMeta(key) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : null;
  }
  setMeta(key, value) {
    this.db
      .prepare('INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)')
      .run(key, JSON.stringify(value));
  }
  cached(key) {
    const row = this.db.prepare('SELECT result FROM model_cache WHERE key=?').get(key);
    return row ? JSON.parse(row.result) : null;
  }
  cache(key, result) {
    this.db
      .prepare('INSERT OR REPLACE INTO model_cache(key,result,created) VALUES(?,?,?)')
      .run(key, JSON.stringify(result), Date.now());
  }
  prune() {
    const cutoff = Date.now() - 60 * 86400000;
    this.db.prepare('DELETE FROM articles WHERE updated<?').run(cutoff);
    this.db.prepare('DELETE FROM model_cache WHERE created<?').run(cutoff);
    this.db.prepare('DELETE FROM ingestion_batches WHERE created<?').run(cutoff);
    this.db
      .prepare('DELETE FROM source_occurrences WHERE article_id NOT IN (SELECT id FROM articles)')
      .run();
    this.db
      .prepare('DELETE FROM editorial_decisions WHERE article_id NOT IN (SELECT id FROM articles)')
      .run();
  }
  close() {
    this.db.close();
  }
}
