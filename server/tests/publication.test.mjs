import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/repositories/sqlite_store.mjs';
import { Collector } from '../src/jobs/collector.mjs';
import { EditorialPolicy, EDITORIAL_VERSION } from '../src/services/editorial.mjs';
import {
  checkSummary,
  PublicationPolicy,
  publicationSettings,
} from '../src/services/publication.mjs';

const body =
  'Python 3.14 agrega mejoras del compilador y nuevas APIs para desarrollar software. Las notas de lanzamiento describen cambios concretos y pruebas reproducibles.';
function prepared(store, suffix = 'one', overrides = {}) {
  const { article } = store.discover({
    url: `https://example.com/${suffix}`,
    title: 'Python 3.14: mejoras del compilador',
    sourceId: 'horizon:hackernews:test',
    sourceType: 'hackernews',
    ingestionShadow: true,
    region: 'Global',
    published: '2026-10-18T12:00:00Z',
  });
  const ready = {
    ...article,
    contentText: body,
    abstract: 'Python 3.14 agrega mejoras del compilador.',
    titleEs: 'Python 3.14: mejoras del compilador',
    keyPoints: ['Nuevas APIs para software.'],
    editorialStatus: 'accepted',
    editorialScore: 9.5,
    evaluationVersion: EDITORIAL_VERSION,
    status: 'ready',
    ...overrides,
  };
  ready.summaryQuality = checkSummary(ready);
  store.save(ready, 'ready');
  return ready;
}

test('Summary checks flag known defects without claiming to prove factual accuracy', () => {
  const a = {
    title: 'Python 3.14',
    contentText: body,
    abstract: 'Python 3,14 agrega APIs.',
    keyPoints: [],
  };
  assert.equal(checkSummary(a).status, 'passed');
  assert.ok(
    checkSummary({ ...a, abstract: 'Mejora un 99%.' }).reasons.includes(
      'numbers_not_found_in_source',
    ),
  );
  assert.ok(
    checkSummary({
      ...a,
      abstract: 'No proporciona hechos verificables ni datos confiables.',
    }).reasons.includes('unsupported_reliability_claim'),
  );
  assert.ok(
    checkSummary({ ...a, abstract: 'Las clases 密封 mejoran Python.' }).reasons.includes(
      'unexpected_script_in_spanish_summary',
    ),
  );
  assert.equal(checkSummary({ ...a, abstract: '' }).status, 'review');
});

test('Canary publishes only eligible prepared documents and enforces a persistent Bogotá daily quota', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  let now = Date.parse('2026-10-19T04:59:00Z'); // 18/10 23:59 in Bogotá.
  let policy = new PublicationPolicy({ store, now: () => now, mode: 'canary', dailyLimit: 1 });
  const first = prepared(store, 'first'),
    second = prepared(store, 'second');
  assert.equal(policy.publish(first), true);
  assert.equal(policy.status().automaticToday, 1);
  assert.equal(store.get(first.id).publicationKind, 'pilot_auto');
  assert.equal(store.get(first.id).editorialReviewed, undefined);
  assert.equal(store.list().length, 1);
  assert.equal(policy.publish(first), false);
  policy = new PublicationPolicy({ store, now: () => now, mode: 'canary', dailyLimit: 1 });
  assert.equal(policy.publish(second), false); // Restarting policy cannot reset quota.
  now = Date.parse('2026-10-19T05:01:00Z');
  assert.equal(policy.status().automaticToday, 0);
  assert.equal(policy.publish(second), true);
  assert.equal(store.list().length, 2);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM publication_events').get().n, 2);
});

test('Pilot rejects untrusted source, old evaluation, duplicate, low score, bad summary and off-topic body', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const policy = new PublicationPolicy({ store, mode: 'canary', dailyLimit: 20 });
  const changes = [
    { sourceType: 'gdelt' },
    { evaluationVersion: 'andes-software-ai-v2' },
    { duplicateCandidateOf: 'other' },
    { editorialScore: 8 },
    { editorialStatus: 'review' },
    { abstract: 'Python ahora mejora un 99%.' },
    {
      title: 'Consejos de ahorro',
      contentText: 'Ahorra dinero cada mes.',
      abstract: 'Ahorra dinero.',
      titleEs: 'Consejos de ahorro',
      keyPoints: [],
    },
  ];
  changes.forEach((overrides, i) =>
    assert.equal(policy.publish(prepared(store, `bad-${i}`, overrides)), false),
  );
  assert.equal(store.list().length, 0);
  assert.equal(
    new PublicationPolicy({ store, mode: 'reviewed' }).publish(prepared(store, 'disabled')),
    false,
  );
});

test('End-to-end shadow pipeline can publish a prepared canary while retaining comparison mode', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const article = prepared(store, 'pipeline', {
    abstract: '',
    contentKind: 'release',
    nativeText: body,
    language: 'es',
  });
  store.save(article, 'queued');
  const client = {
    revision: 'fixture',
    predict: async () => ({
      probabilities: { relevant: 0.99, technical: 0.99, evidence: 0.99, useful: 0.99 },
    }),
  };
  const collector = new Collector({
    store,
    editorial: new EditorialPolicy({ store, mode: 'shadow', dedup: 'off', client }),
    publication: new PublicationPolicy({ store, mode: 'canary' }),
    model: {
      summarize: async () => ({
        abstract: 'Python 3.14 agrega nuevas APIs.',
        titleEs: article.title,
        keyPoints: [],
      }),
    },
  });
  await collector.processOne();
  assert.equal(collector.editorial.mode, 'shadow');
  assert.equal(store.get(article.id).summaryQuality.status, 'passed');
  assert.equal(store.get(article.id).publicationKind, 'pilot_auto');
  assert.equal(store.list().length, 1);
});

test('Main-topic gate ignores a technical tail and never sends an unbounded body when out of scope', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const calls = [];
  const policy = new EditorialPolicy({
    store,
    mode: 'laya',
    client: {
      revision: 'scope-fixture',
      predict: async (input) => {
        calls.push(input);
        return { probabilities: { relevant: 0.05, technical: 0.99, evidence: 0.99, useful: 0.99 } };
      },
    },
  });
  const decision = await policy.evaluate({
    id: 'unrelated',
    title: 'Una aspiradora para el hogar',
    contentText: 'Consumer vacuum cleaner. '.repeat(1000) + 'Python software API',
    abstract: 'Python software API',
  });
  assert.equal(decision.editorialStatus, 'rejected');
  assert.equal(calls.length, 1);
  assert.ok(Buffer.byteLength(calls[0].lead) <= 1200);
  assert.equal(store.decisions()[0].bodyEvaluated, false);
  assert.equal(store.decisions()[0].windowCount, 0);
});

test('Publication configuration rejects invalid modes and unsafe quotas', () => {
  assert.equal(publicationSettings({}).mode, 'reviewed');
  assert.throws(() => publicationSettings({ PUBLICATION_MODE: 'all' }));
  assert.throws(() => publicationSettings({ PILOT_DAILY_LIMIT: '1000' }));
  assert.throws(() => publicationSettings({ PILOT_MIN_SCORE: '0' }));
});
