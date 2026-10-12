import Fastify from 'fastify';
import { installAuthentication } from './plugins/authentication.mjs';
import { articleRoutes } from './routes/articles.mjs';

export function createApi({
  store,
  collector,
  apiToken = process.env.ANDES_API_TOKEN,
  logger = false,
} = {}) {
  const app = Fastify({
    logger: logger
      ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] }
      : false,
    requestTimeout: 15000,
    bodyLimit: 16384,
  });
  app.server.headersTimeout = 10000;
  installAuthentication(app, apiToken);
  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      const invalidId = error.validationContext === 'params';
      return reply
        .code(invalidId ? 404 : 400)
        .send({ error: invalidId ? 'Article not found' : 'Invalid pagination' });
    }
    const status = error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) request.log.error({ err: error }, 'API request failed');
    return reply
      .code(status)
      .send({ error: status === 500 ? 'Internal server error' : 'Invalid request' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  app.register(articleRoutes, { store, collector });
  return app;
}
