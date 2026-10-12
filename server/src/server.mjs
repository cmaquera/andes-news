import { pathToFileURL } from 'node:url';
import { createApi } from './app.mjs';
import { serverSettings, APP_VERSION } from './config/env.mjs';
import { Store } from './repositories/sqlite_store.mjs';
import { Collector } from './jobs/collector.mjs';

// The executable owns the database and worker. createApi only builds Fastify,
// so route tests and future consumers can provide their own dependencies.
export async function startServer({
  settings = serverSettings(),
  store,
  collector,
  logger = true,
} = {}) {
  store ??= new Store(settings.databasePath);
  collector ??= new Collector({ store });
  let app;
  try {
    app = createApi({ store, collector, apiToken: settings.apiToken, logger });
    app.addHook('preClose', async () => collector.stop());
    app.addHook('onClose', async () => store.close());
    await app.listen({ port: settings.port, host: settings.host });
    collector.start();
    app.log.info(`Andes News ${APP_VERSION}: Fastify API, collection every two hours`);
    return app;
  } catch (error) {
    if (app) await app.close();
    else store.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const app = await startServer();
    let closing = false;
    for (const signal of ['SIGINT', 'SIGTERM'])
      process.once(signal, async () => {
        if (closing) return;
        closing = true;
        try {
          await app.close();
          process.exit(0);
        } catch (error) {
          app.log.error({ err: error }, 'Shutdown failed');
          process.exit(1);
        }
      });
  } catch (error) {
    console.error('Andes startup failed:', error.message);
    process.exit(1);
  }
}
