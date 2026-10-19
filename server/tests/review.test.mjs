import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exportSnapshot, category } from '../src/review/snapshot.mjs';
import { createReviewApp } from '../src/review/app.mjs';

function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'andes-review-'));
  t.after(async () => {
    for (const app of t.reviewApps ?? []) await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function fixture(t) {
  const dir = directory(t),
    path = join(dir, 'source.db');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE articles(id TEXT,data TEXT,state TEXT,updated INTEGER,discovered INTEGER);
    CREATE TABLE editorial_decisions(article_id TEXT,data TEXT);
    CREATE TABLE source_occurrences(article_id TEXT,data TEXT);`);
  const a = {
    id: 'a',
    title: 'Python release',
    url: 'https://example.com/a',
    sourceId: 'hn',
    editorialStatus: 'accepted',
    ingestionShadow: true,
    contentText: 'x'.repeat(17000),
    abstract: 'Resumen',
  };
  db.prepare('INSERT INTO articles VALUES (?,?,?,?,?)').run('a', JSON.stringify(a), 'ready', 1, 1);
  db.prepare('INSERT INTO editorial_decisions VALUES (?,?)').run(
    'a',
    JSON.stringify({ status: 'accepted', score: 9 }),
  );
  db.prepare('INSERT INTO source_occurrences VALUES (?,?)').run(
    'a',
    JSON.stringify({ sourceType: 'hackernews', url: a.url, externalId: '123' }),
  );
  db.close();
  return { dir, path };
}
const headers = { host: '127.0.0.1:8791', origin: 'http://127.0.0.1:8791' };
const vote = (a) => ({
  articleId: a.id,
  fingerprint: a.fingerprint,
  verdict: 'incorrect',
  expected: 'reject',
  duplicate: 'unspecified',
  summary: 'errors',
  note: 'El resumen inventa cifras.',
});

test('snapshot is read-only, complete, bounded and distinguishes hidden accepted articles', (t) => {
  const { path } = fixture(t),
    before = readFileSync(path);
  const s = exportSnapshot(path);
  assert.equal(s.total, 1);
  assert.equal(s.articles[0].category, 'shadow');
  assert.equal(s.articles[0].excerpt.length, 16000);
  assert.equal(s.articles[0].bodyTruncated, true);
  assert.equal(s.articles[0].occurrences[0].source, 'Hacker News');
  assert.equal(s.articles[0].decision.score, 9);
  assert.deepEqual(readFileSync(path), before);
  assert.equal(category({ state: 'filtered', editorialStatus: 'review' }), 'review');
  assert.equal(category({ state: 'filtered' }), 'filtered');
  assert.equal(category({ duplicateCandidateOf: 'x' }), 'candidate');
  assert.equal(category({ duplicateOf: 'x' }), 'duplicate');
  assert.equal(category({ ingestionShadow: true, editorialStatus: 'rejected' }), 'rejected');
});

test('human comparisons can flag a missed duplicate and preserve both evaluation versions', async (t) => {
  const { path, dir } = fixture(t),
    snapshot = exportSnapshot(path);
  const a = snapshot.articles[0];
  const b = {
    ...a,
    id: 'b',
    title: 'Independent coverage',
    url: 'https://example.com/b',
    fingerprint: 'version-b',
  };
  snapshot.articles.push(b);
  snapshot.total++;
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(snapshot));
  const app = createReviewApp({ dataDir: dir });
  t.reviewApps = [app];
  const payload = {
    ...vote(a),
    duplicate: 'same',
    comparisonId: 'b',
    comparisonFingerprint: b.fingerprint,
  };
  const saved = await app.inject({ method: 'POST', url: '/api/feedback', headers, payload });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().feedback.comparison, {
    id: 'b',
    fingerprint: 'version-b',
    title: b.title,
    url: b.url,
  });
  for (const [patch, status] of [
    [{ comparisonId: 'a' }, 400],
    [{ comparisonId: 'missing' }, 400],
    [{ comparisonFingerprint: 'old' }, 409],
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/feedback',
          headers,
          payload: { ...payload, ...patch },
        })
      ).statusCode,
      status,
    );
  }
  assert.equal(
    (await app.inject({ url: '/api/feedback/export', headers })).json().feedback.length,
    1,
  );
});

test('feedback persists with append-only history and never changes source or snapshot', async (t) => {
  const { path, dir } = fixture(t);
  const snapshot = exportSnapshot(path);
  const a = snapshot.articles[0];
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(snapshot));
  const before = readFileSync(path),
    frozen = readFileSync(join(dir, 'snapshot.json'));
  let app = createReviewApp({ dataDir: dir });
  const saved = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers,
    payload: vote(a),
  });
  assert.equal(saved.statusCode, 200);
  const savedId = saved.json().feedback.id;
  await app.close();
  app = createReviewApp({ dataDir: dir });
  const res = await app.inject({ url: '/api/review', headers });
  assert.equal(res.json().articles[0].feedback.id, savedId);
  await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers,
    payload: { ...vote(a), verdict: 'correct', note: 'Corrección de mi revisión' },
  });
  const exported = await app.inject({ url: '/api/feedback/export', headers });
  assert.equal(exported.json().feedback.length, 2);
  assert.equal(exported.json().feedback[0].verdict, 'incorrect');
  assert.equal(exported.json().feedback[1].verdict, 'correct');
  await app.close();
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(readFileSync(join(dir, 'snapshot.json')), frozen);
  snapshot.articles[0].fingerprint = 'changed';
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(snapshot));
  app = createReviewApp({ dataDir: dir });
  const updated = (await app.inject({ url: '/api/review', headers })).json().articles[0];
  assert.notEqual(updated.fingerprint, updated.feedback.fingerprint);
  await app.close();
});

test('review API rejects foreign origins, invalid labels, stale versions and unsupported mutations', async (t) => {
  const { path, dir } = fixture(t),
    snapshot = exportSnapshot(path),
    a = snapshot.articles[0];
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(snapshot));
  const app = createReviewApp({ dataDir: dir });
  t.reviewApps = [app];
  for (const evil of [
    { host: 'attacker.example:8791' },
    { ...headers, origin: 'https://evil.example' },
    { ...headers, 'sec-fetch-site': 'cross-site' },
  ]) {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/feedback', headers: evil, payload: vote(a) }))
        .statusCode,
      403,
    );
  }
  for (const [patch, status] of [
    [{ fingerprint: 'stale' }, 409],
    [{ articleId: 'missing' }, 404],
    [{ verdict: 'publish' }, 400],
    [{ note: 'x'.repeat(4001) }, 400],
    [{ duplicate: 'same' }, 400],
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/feedback',
          headers,
          payload: { ...vote(a), ...patch },
        })
      ).statusCode,
      status,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/reviews/a',
        headers,
        payload: { status: 'accepted' },
      })
    ).statusCode,
    404,
  );
  const page = await app.inject({ url: '/', headers });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(
    (await app.inject({ url: '/api/feedback/export', headers })).json().feedback.length,
    0,
  );
});
