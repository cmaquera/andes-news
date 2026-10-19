import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/repositories/sqlite_store.mjs';
import { createIngestionApi, SOURCE_TYPES } from '../src/routes/ingestion.mjs';
import { createApi } from '../src/app.mjs';
import { Collector } from '../src/jobs/collector.mjs';
import { EditorialPolicy, LayaClient, similarTitles } from '../src/services/editorial.mjs';

const token = 'ingestion-test-token-at-least-32-characters';
const headers = { authorization: `Bearer ${token}` };
const nativeText =
  'Python 3.14 introduces concrete improvements to the interpreter and developer APIs. The release notes explain the implementation, benchmark methodology, migration instructions and limitations for software engineers.';
function entry(type = 'github', externalId = 'release-1') {
  return {
    sourceInstanceId: `${type}:test`,
    sourceType: type,
    externalId,
    contentKind: 'release',
    sourceUrl: 'https://example.com/python',
    title: 'Python interpreter API release',
    nativeText,
    publishedAt: '2026-10-18T10:00:00Z',
    sourceName: `${type} test`,
    languageHint: 'es',
  };
}
const batch = (items, batchId = 'batch-1') => ({
  schemaVersion: 1,
  batchId,
  producerRevision: 'test',
  items,
});
function setup(t, options = {}) {
  const store = new Store(':memory:');
  const app = createIngestionApi({ store, token, ...options });
  t.after(async () => {
    await app.close();
    store.close();
  });
  return {
    store,
    app,
    post: (payload, credential = headers) =>
      app.inject({ method: 'POST', url: '/batches', headers: credential, payload }),
  };
}
const client = (probability = 0.95) => ({
  revision: `fixture-model-${probability}`,
  predict: async () => ({
    probabilities: {
      relevant: probability,
      technical: probability,
      evidence: probability,
      useful: probability,
    },
    routing: { model: 'fixture' },
  }),
});

test('Shadow evaluation of rule-negative legacy candidates never exposes them in the feed', async (t) => {
  const { store } = setup(t);
  const collector = new Collector({
    store,
    editorial: new EditorialPolicy({ store, client: client(), mode: 'shadow' }),
    load: async () => [
      {
        title: 'Oferta de un celular nuevo',
        url: 'https://example.com/offer',
        sourceId: 'rss',
        region: 'Global',
      },
    ],
  });
  await collector.discover();
  assert.equal(store.list().length, 0);
  assert.equal(store.counts().queued, 1);
  assert.equal(store.next().ingestionShadow, true);
});

test('Private ingress accepts ten source types, authenticates and replays atomically', async (t) => {
  const { store, app, post } = setup(t, { mode: 'active' });
  const payload = batch(SOURCE_TYPES.map((type) => entry(type)));
  assert.equal((await post(payload, {})).statusCode, 401);
  const first = await post(payload);
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().results.length, 10);
  assert.equal(store.counts().queued, 1);
  const id = first.json().results[0].articleId;
  assert.equal(store.get(id).sourceOccurrences.length, 10);
  assert.deepEqual((await post(payload)).json(), first.json());
  assert.equal((await post({ ...payload, items: [entry()] })).statusCode, 409);
  assert.equal(store.sourceCatalog().length, 10);
  const publicApi = createApi({ store, apiToken: token });
  t.after(() => publicApi.close());
  assert.equal(
    (await publicApi.inject({ method: 'POST', url: '/batches', headers, payload })).statusCode,
    404,
  );
  assert.equal((await app.inject({ url: '/evaluations', headers })).statusCode, 200);
});

test('Unsafe items are quarantined, schema bounded and shadow entries stay out of feed', async (t) => {
  const { store, post } = setup(t);
  const result = await post(
    batch([entry(), { ...entry('rss', 'unsafe'), sourceUrl: 'http://127.0.0.1/private' }]),
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().results[1].status, 'rejected');
  assert.equal(store.list().length, 0);
  assert.equal(store.sourceCatalog().length, 0);
  assert.equal(
    (await post(batch([{ ...entry(), sourceType: 'unsupported' }], 'bad'))).statusCode,
    400,
  );
  assert.equal(
    (
      await post(
        batch(
          Array.from({ length: 51 }, () => entry()),
          'large',
        ),
      )
    ).statusCode,
    400,
  );
});

test('Native publication runs end to end without extraction; active score is separate from votes', async (t) => {
  const { store, post } = setup(t, { mode: 'active' });
  const response = await post(batch([{ ...entry(), engagement: { score: 123 } }]));
  let summaries = 0;
  const editorial = new EditorialPolicy({ store, client: client(), mode: 'laya', dedup: 'off' });
  const collector = new Collector({
    store,
    editorial,
    extractor: {
      extract() {
        throw Error('Native content must not be extracted');
      },
    },
    model: {
      async summarize() {
        summaries++;
        return { abstract: 'Resumen técnico', titleEs: 'Python', keyPoints: [] };
      },
      async translate(blocks) {
        return blocks;
      },
    },
  });
  assert.equal(await collector.processOne(), true);
  const article = store.get(response.json().results[0].articleId);
  assert.equal(article.status, 'ready');
  assert.equal(article.coverage, 'native');
  assert.equal(article.score, 123);
  assert.equal(article.editorialScore, 9.5);
  assert.equal(store.list({ editorial: true }).length, 1);
  assert.equal(store.decisions()[0].status, 'accepted');
  assert.equal(summaries, 1);
  await post(batch([entry('telegram')], 'another'));
  assert.equal(await collector.processOne(), false);
  assert.equal(store.get(article.id).sourceOccurrences.length, 2);
});

test('Laya rejects noise, abstains on uncertainty, covers long text and survives outage in shadow', async (t) => {
  const { store, post } = setup(t, { mode: 'active' });
  const res = await post(batch([entry()]));
  const article = { ...store.get(res.json().results[0].articleId), contentText: nativeText };
  assert.equal(
    (await new EditorialPolicy({ store, client: client(0.05), mode: 'laya' }).evaluate(article))
      .editorialStatus,
    'rejected',
  );
  assert.equal(
    (await new EditorialPolicy({ store, client: client(0.5), mode: 'laya' }).evaluate(article))
      .editorialStatus,
    'review',
  );
  assert.equal(
    (
      await new EditorialPolicy({ store, client: client(), mode: 'laya' }).evaluate({
        ...article,
        contentText: nativeText.repeat(50),
      })
    ).editorialStatus,
    'accepted',
  );
  assert.ok(store.decisions()[0].windowCount > 1);
  assert.equal(store.decisions()[0].truncated, false);
  const unavailable = {
    revision: 'down',
    predict: async () => {
      throw Error('timeout');
    },
  };
  const shadow = await new EditorialPolicy({ store, client: unavailable, mode: 'shadow' }).evaluate(
    article,
  );
  assert.equal(shadow.relevance.accepted, true);
  assert.equal(shadow.editorialStatus, 'error');
  await assert.rejects(() =>
    new EditorialPolicy({ store, client: unavailable, mode: 'laya' }).evaluate(article),
  );
});

test('Laya uses authenticated native HTTP contract and rejects malformed decisions', async () => {
  let body;
  const laya = new LayaClient({
    endpoint: 'http://laya:8000',
    token,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://laya:8000/v1/systemone');
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      body = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          answers: Object.fromEntries(
            Object.keys(body.questions).map((q) => [
              q,
              body.questions[q].type === 'choice'
                ? { choice: 'software', probabilities: { software: 0.85, ai: 0.05, other: 0.1 } }
                : { noul: 0.9 },
            ]),
          ),
        }),
      );
    },
  });
  await laya.predict({ text: 'example' });
  assert.equal(body.model, 'multilingual');
  const invalid = new LayaClient({ fetchImpl: async () => new Response('{"answers":{}}') });
  await assert.rejects(() => invalid.predict('bad'), /laya_invalid_answer/);
  assert.equal(
    similarTitles(
      'Python 3.13 interpreter API release changes',
      'Python 3.14 interpreter API release changes',
    ),
    false,
  );
});

test('Exact and semantic deduplication retain detail and aggregate provenance', async (t) => {
  const { store, post } = setup(t, { mode: 'active' });
  const first = (await post(batch([entry()], 'first'))).json().results[0].articleId;
  store.save(
    { ...store.get(first), contentText: nativeText, editorialStatus: 'accepted' },
    'ready',
  );
  const second = (
    await post(
      batch(
        [{ ...entry('rss', 'second'), sourceUrl: 'https://example.org/other', nativeText }],
        'second',
      ),
    )
  ).json().results[0].articleId;
  const policy = new EditorialPolicy({ store, client: client(), mode: 'laya', dedup: 'active' });
  assert.equal(
    (await policy.duplicate({ ...store.get(second), contentText: nativeText })).method,
    'content_hash',
  );
  store.save(
    {
      ...store.get(second),
      contentText: nativeText,
      duplicateOf: first,
      editorialStatus: 'duplicate',
    },
    'filtered',
  );
  assert.equal(store.get(first).sourceOccurrences.length, 2);
  assert.equal(store.get(second).editorialStatus, 'duplicate');
  let pairs = 0;
  const pairPolicy = new EditorialPolicy({
    store,
    mode: 'laya',
    dedup: 'active',
    client: {
      predict: async () => {
        pairs++;
        return { probabilities: { same_event: 0.99 } };
      },
    },
  });
  const candidate = {
    ...store.get(second),
    contentText: 'A different text about the same specific release, with the same useful facts.',
  };
  assert.equal((await pairPolicy.duplicate(candidate)).method, 'laya_pair');
  assert.equal(pairs, 1);
  assert.equal(
    await pairPolicy.duplicate({
      ...candidate,
      title: 'Entirely unrelated engineering tutorial about database indexes',
    }),
    null,
  );
});

test('Edited native content requeues its document and invalidates its old summary', async (t) => {
  const { store, post } = setup(t, { mode: 'active' });
  const id = (await post(batch([entry()]))).json().results[0].articleId;
  store.save(
    {
      ...store.get(id),
      abstract: 'Old abstract',
      contentText: nativeText,
      translatedContent: [{ type: 'paragraph', text: 'old' }],
    },
    'ready',
  );
  await post(
    batch([{ ...entry(), nativeText: nativeText + ' Additional release corrections.' }], 'edit'),
  );
  assert.equal(store.get(id).status, 'queued');
  assert.equal(store.get(id).abstract, '');
  assert.equal(store.get(id).contentText, '');
  assert.equal(store.get(id).sourceOccurrences.length, 1);
});

test('Human acceptance publishes only the reviewed shadow document and its source', async (t) => {
  const { store, post, app } = setup(t);
  const id = (await post(batch([entry()]))).json().results[0].articleId;
  const hiddenId = (
    await post(
      batch(
        [{ ...entry('telegram', 'hidden'), sourceUrl: 'https://example.com/hidden' }],
        'hidden-batch',
      ),
    )
  ).json().results[0].articleId;
  store.save({ ...store.get(id), abstract: 'Resumen revisado', contentText: nativeText }, 'ready');
  const review = await app.inject({
    method: 'POST',
    url: `/reviews/${id}`,
    headers,
    payload: { status: 'accepted' },
  });
  assert.equal(review.statusCode, 200);
  assert.equal(store.get(id).ingestionShadow, false);
  assert.equal(store.get(id).editorialReviewed, true);
  assert.equal(store.get(hiddenId).ingestionShadow, true);
  assert.deepEqual(
    store.list({ editorial: true }).map((a) => a.id),
    [id],
  );
  assert.deepEqual(
    store.sourceCatalog().map((s) => s.kind),
    ['github'],
  );
  await app.inject({
    method: 'POST',
    url: `/reviews/${id}`,
    headers,
    payload: { status: 'rejected' },
  });
  assert.equal(store.list().length, 0);
});

test('Hidden shadow decisions outside acceptance consume no summary or translation inference', async (t) => {
  const { store, post } = setup(t);
  const id = (await post(batch([entry()]))).json().results[0].articleId;
  let calls = 0;
  const collector = new Collector({
    store,
    editorial: new EditorialPolicy({ store, client: client(0.5), mode: 'shadow' }),
    model: {
      async summarize() {
        calls++;
        throw Error('Must not summarize review items');
      },
      async translate() {
        calls++;
        throw Error('Must not translate review items');
      },
    },
  });
  await collector.processOne();
  assert.equal(store.get(id).status, 'filtered');
  assert.equal(store.get(id).editorialStatus, 'review');
  assert.equal(store.decisions()[0].status, 'review');
  assert.equal(calls, 0);
  assert.equal(store.list().length, 0);
});

test('Committed batches, decisions and queued native content survive database restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'andes-ingestion-'));
  let store = new Store(join(dir, 'test.db'));
  let app = createIngestionApi({ store, token, mode: 'active' });
  const payload = batch([entry()]);
  const result = (await app.inject({ method: 'POST', url: '/batches', headers, payload })).json();
  const id = result.results[0].articleId;
  store.recordDecision(id, { status: 'review' });
  await app.close();
  store.close();
  try {
    store = new Store(join(dir, 'test.db'));
    app = createIngestionApi({ store, token, mode: 'active' });
    assert.deepEqual(
      (await app.inject({ method: 'POST', url: '/batches', headers, payload })).json(),
      result,
    );
    assert.equal(store.get(id).nativeText, nativeText);
    assert.equal(store.decisions()[0].status, 'review');
  } finally {
    await app.close();
    store.close();
    rmSync(dir, { recursive: true });
  }
});
