import { createHash, timingSafeEqual } from 'node:crypto';
const hash = (value) => createHash('sha256').update(value).digest();

export function installAuthentication(app, apiToken) {
  if (typeof apiToken !== 'string' || apiToken.length < 32)
    throw Error('Set ANDES_API_TOKEN to a random token of at least 32 characters');
  const secret = hash(`Bearer ${apiToken}`);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    // Only explicitly declared public routes can skip authentication.
    if (request.routeOptions.config?.public === true) return;
    const credential = request.headers.authorization;
    if (typeof credential !== 'string' || !timingSafeEqual(hash(credential), secret))
      return reply.code(401).send({ error: 'Unauthorized' });
  });
}
