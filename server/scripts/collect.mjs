import { Store } from '../src/repositories/sqlite_store.mjs';
import { Collector } from '../src/jobs/collector.mjs';
const store = new Store(process.env.DATABASE_PATH ?? '/data/andes.db');
try {
  const collector = new Collector({ store });
  await collector.discover();
  console.log(
    JSON.stringify({ collection: store.getMeta('collection'), counts: store.counts() }, null, 2),
  );
} finally {
  store.close();
}
