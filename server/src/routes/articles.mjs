import { sources } from '../config/sources.mjs';
import { APP_VERSION } from '../config/env.mjs';
import { pagination, articleId } from '../schemas/articles.mjs';

export async function articleRoutes(app, { store, collector }) {
  app.get('/', { config: { public: true } }, async () => ({
    service: 'Andes News',
    version: APP_VERSION,
    health: '/health',
  }));
  app.get('/health', { config: { public: true } }, async () => ({ status: 'ok' }));
  app.get('/sources', async () => ({ sources }));
  app.get('/status', async () => ({
    collection: store.getMeta('collection'),
    nextCollectionAt: store.getMeta('nextCollectionAt'),
    counts: store.counts(),
    processing: collector?.processing ?? false,
  }));
  app.get('/articles', { schema: { querystring: pagination } }, async (request) => {
    const { limit, offset } = request.query,
      articles = store.list({ limit, offset });
    return {
      articles,
      nextOffset: articles.length === limit ? offset + limit : null,
      collection: store.getMeta('collection'),
      counts: store.counts(),
      nextCollectionAt: store.getMeta('nextCollectionAt'),
    };
  });
  app.get('/articles/:id', { schema: { params: articleId } }, async (request, reply) => {
    const article = store.get(request.params.id);
    if (!article) return reply.code(404).send({ error: 'Article not found' });
    const { contentText, ...detail } = article;
    return { article: detail };
  });
  app.all('/summary', async (_request, reply) =>
    reply.code(410).send({
      error: 'Upgrade Andes: summaries are prepared from article bodies in the background.',
    }),
  );
}
