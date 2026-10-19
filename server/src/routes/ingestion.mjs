import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { installAuthentication } from '../plugins/authentication.mjs';
import { canonicalUrl } from '../repositories/sqlite_store.mjs';

export const SOURCE_TYPES = [
  'hackernews',
  'rss',
  'reddit',
  'telegram',
  'twitter',
  'github',
  'openbb',
  'ossinsight',
  'gdelt',
  'google_news',
];
const string = { type: 'string', maxLength: 2048 };
const item = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sourceInstanceId',
    'sourceType',
    'externalId',
    'contentKind',
    'sourceUrl',
    'title',
    'publishedAt',
  ],
  properties: {
    sourceInstanceId: { type: 'string', pattern: '^[a-zA-Z0-9:_./@-]{1,200}$' },
    sourceType: { enum: SOURCE_TYPES },
    externalId: { type: 'string', minLength: 1, maxLength: 300 },
    contentKind: { enum: ['article', 'social_post', 'discussion', 'release', 'repository'] },
    sourceUrl: string,
    targetUrl: { anyOf: [string, { type: 'null' }] },
    title: { type: 'string', minLength: 1, maxLength: 1000 },
    nativeText: { type: 'string', maxLength: 32000 },
    sourceName: { type: 'string', maxLength: 200 },
    author: { type: 'string', maxLength: 200 },
    publishedAt: { type: 'string', maxLength: 40 },
    fetchedAt: { type: 'string', maxLength: 40 },
    languageHint: { type: 'string', maxLength: 20 },
    comments: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 2000 } },
    engagement: {
      type: 'object',
      additionalProperties: false,
      properties: {
        score: { type: 'integer', minimum: 0 },
        comments: { type: 'integer', minimum: 0 },
      },
    },
  },
};
export function createIngestionApi({ store, token, mode = 'shadow', logger = false } = {}) {
  if (!['shadow', 'active'].includes(mode)) throw Error('Invalid INGESTION_MODE');
  const app = Fastify({ logger, bodyLimit: 2_000_000 });
  installAuthentication(app, token);
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ code: error.code }, 'Ingestion failed');
    reply
      .code(error.validation ? 400 : error.statusCode === 413 ? 413 : 500)
      .send({ error: 'Invalid ingestion request' });
  });
  app.get('/health', async () => ({ status: 'ok', mode }));
  app.get('/evaluations', async () => ({
    decisions: store.decisions(),
    counts: store.counts(),
    ingestion: store.getMeta('ingestion'),
  }));
  app.post(
    '/reviews/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: '^[a-f0-9]{32}$' } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { enum: ['accepted', 'rejected'] } },
        },
      },
    },
    async (request, reply) => {
      const article = store.get(request.params.id);
      if (!article) return reply.code(404).send({ error: 'Article not found' });
      const accepted = request.body.status === 'accepted';
      article.editorialReviewed = true;
      article.editorialStatus = request.body.status;
      // A human acceptance explicitly publishes this document from the pilot.
      // Other shadow documents remain hidden until reviewed individually.
      if (accepted) article.ingestionShadow = false;
      article.relevance = { ...article.relevance, accepted, reason: 'human_review' };
      article.selectionReasons = ['Selección revisada manualmente'];
      delete article.duplicateOf;
      store.save(
        article,
        accepted ? (article.abstract && article.contentText ? 'ready' : 'queued') : 'filtered',
      );
      store.db.prepare('UPDATE articles SET attempts=0,retry_at=0 WHERE id=?').run(article.id);
      const previous = store.decisions().find((d) => d.articleId === article.id) ?? {};
      store.recordDecision(article.id, {
        ...previous,
        status: article.editorialStatus,
        reviewedAt: new Date().toISOString(),
        reviewer: 'service_operator',
      });
      return { id: article.id, editorialStatus: article.editorialStatus };
    },
  );
  app.post(
    '/batches',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion', 'batchId', 'producerRevision', 'items'],
          properties: {
            schemaVersion: { const: 1 },
            batchId: { type: 'string', pattern: '^[a-zA-Z0-9-]{1,100}$' },
            producerRevision: { type: 'string', maxLength: 100 },
            items: { type: 'array', maxItems: 50, items: item },
          },
        },
      },
    },
    async (request, reply) => {
      const batch = request.body;
      const digest = createHash('sha256').update(JSON.stringify(batch)).digest('hex');
      const previous = store.batch(batch.batchId);
      if (previous)
        return previous.digest === digest
          ? previous.result
          : reply.code(409).send({ error: 'Batch ID content mismatch' });
      const normalized = [];
      const results = batch.items.map((entry, index) => {
        try {
          const sourceUrl = canonicalUrl(entry.sourceUrl),
            url = canonicalUrl(entry.targetUrl ?? sourceUrl);
          if (!Number.isFinite(Date.parse(entry.publishedAt))) throw Error('invalid_date');
          normalized.push({ ...entry, sourceUrl, url, index });
          return { index, status: 'accepted' };
        } catch (_) {
          return { index, status: 'rejected', error: 'invalid_item_url_or_date' };
        }
      });
      store.ingestBatch(batch, digest, normalized, results, mode);
      return { batchId: batch.batchId, results };
    },
  );
  return app;
}
