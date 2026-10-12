import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.mjs';
import { serverSettings, APP_VERSION } from '../src/config/env.mjs';
import { Store } from '../src/repositories/sqlite_store.mjs';

const token = 'test-only-token-with-at-least-32-characters';
function dependencies() {
  const store = new Store(':memory:'),
    events = [];
  const close = store.close.bind(store);
  store.close = () => {
    events.push('database-close');
    close();
  };
  const collector = {
    processing: false,
    start() {
      events.push('worker-start');
    },
    stop() {
      events.push('worker-stop');
    },
  };
  return {
    store,
    collector,
    events,
    logger: false,
    settings: { apiToken: token, host: '127.0.0.1', port: 0 },
  };
}
test('New server entry starts worker after listening and owns shutdown resources', async (t) => {
  const deps = dependencies();
  const app = await startServer(deps);
  t.after(() => app.close());
  assert.deepEqual(deps.events, ['worker-start']);
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, APP_VERSION);
  await app.close();
  assert.deepEqual(deps.events, ['worker-start', 'worker-stop', 'database-close']);
});
test('Invalid credentials close database without starting worker', async () => {
  const deps = dependencies();
  deps.settings.apiToken = 'short';
  await assert.rejects(() => startServer(deps), /ANDES_API_TOKEN/);
  assert.deepEqual(deps.events, ['database-close']);
});
test('Occupied port cleans up and never starts a second worker', async (t) => {
  const first = await startServer(dependencies());
  t.after(() => first.close());
  const second = dependencies();
  second.settings.port = first.server.address().port;
  await assert.rejects(() => startServer(second), { code: 'EADDRINUSE' });
  assert.ok(second.events.includes('database-close'));
  assert.ok(!second.events.includes('worker-start'));
});
test('Environment configuration keeps ports, private host and database path explicit', () => {
  const settings = serverSettings({
    PORT: '9090',
    HOST: '0.0.0.0',
    DATABASE_PATH: '/data/andes.db',
    ANDES_API_TOKEN: token,
  });
  assert.equal(settings.port, 9090);
  assert.equal(settings.host, '0.0.0.0');
  assert.equal(settings.databasePath, '/data/andes.db');
  assert.equal(settings.apiToken, token);
  assert.throws(() => serverSettings({ PORT: 'invalid' }), /PORT/);
});
