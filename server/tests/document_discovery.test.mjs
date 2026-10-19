import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentDiscovery } from '../src/services/document_discovery.mjs';
import { Store } from '../src/repositories/sqlite_store.mjs';
import { createApi } from '../src/app.mjs';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
test('Opening an old story responds immediately, caches documents and never rewrites the story', async (t) => {
  const store = new Store(':memory:');
  const a = store.discover({
    title: 'Python software research',
    url: 'https://news.example/story',
    sourceId: 'hn',
    region: 'Global',
  }).article;
  store.save(
    { ...a, contentText: 'Original journalist body', abstract: 'Original summary' },
    'ready',
  );
  const before = store.db.prepare('SELECT data FROM articles WHERE id=?').get(a.id).data;
  let release,
    calls = 0;
  const done = new Promise((resolve) => (release = resolve));
  const documents = new DocumentDiscovery({
    store,
    discover: async () => {
      calls++;
      return done;
    },
  });
  const token = 'test-document-discovery-token-with-32-characters';
  const app = createApi({ store, documents, apiToken: token });
  t.after(async () => {
    documents.close();
    await app.close();
    store.close();
  });
  const request = () =>
    app.inject({ url: '/articles/' + a.id, headers: { authorization: 'Bearer ' + token } });
  assert.equal((await app.inject({ url: '/articles/' + a.id })).statusCode, 401);
  assert.equal(calls, 0);
  assert.equal((await request()).json().article.documentDiscovery, 'pending');
  assert.equal((await request()).json().article.documentDiscovery, 'pending');
  assert.equal(calls, 1);
  release({
    papers: [
      {
        title: 'University study',
        pdfUrl: 'https://archive.example/paper.pdf',
        relation: 'reference',
      },
    ],
  });
  await nextTurn();
  const article = (await request()).json().article;
  assert.equal(article.documentDiscovery, 'complete');
  assert.equal(article.papers[0].pdfUrl, 'https://archive.example/paper.pdf');
  assert.equal(article.abstract, 'Original summary');
  assert.equal(calls, 1);
  assert.equal(store.db.prepare('SELECT data FROM articles WHERE id=?').get(a.id).data, before);
});

test('Cached success expires and failures back off; known formats do not trigger new requests', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  let now = 1000,
    calls = 0;
  const service = new DocumentDiscovery({
    store,
    now: () => now,
    discover: async () => {
      calls++;
      if (calls > 1) throw Error('publisher_down');
      return { papers: [] };
    },
  });
  t.after(() => service.close());
  const article = { id: 'one', url: 'https://news.example/one' };
  assert.equal(service.read({ ...article, papers: [] }).status, 'complete');
  assert.equal(
    service.read({ ...article, paper: { pdfUrl: 'https://journal.example/a.pdf' } }).papers.length,
    1,
  );
  assert.equal(calls, 0);
  assert.equal(service.read(article).status, 'pending');
  await nextTurn();
  assert.equal(service.read(article).status, 'complete');
  now += 86400001;
  assert.equal(service.read(article).status, 'pending');
  await nextTurn();
  assert.equal(service.read(article).status, 'unavailable');
  assert.equal(calls, 2);
  now += 600001;
  assert.equal(service.read(article).status, 'pending');
  await nextTurn();
  assert.equal(calls, 3);
});

test('Discovery caps concurrency and queue and stops writing cache after shutdown', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const releases = [];
  let started = 0;
  const service = new DocumentDiscovery({
    store,
    discover: async () => {
      started++;
      return new Promise((resolve) => releases.push(resolve));
    },
  });
  for (let i = 0; i < 20; i++)
    assert.equal(
      service.read({ id: String(i), url: 'https://news.example/' + i }).status,
      'pending',
    );
  assert.equal(
    service.read({ id: 'overflow', url: 'https://news.example/overflow' }).status,
    'unavailable',
  );
  await nextTurn();
  assert.equal(started, 2);
  service.close();
  for (const release of releases) release({ papers: [] });
  await nextTurn();
  assert.equal(started, 2);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM model_cache').get().n, 0);
});
