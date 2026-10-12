import test from 'node:test';
import assert from 'node:assert/strict';
import { ollamaEndpoint, parsePort } from '../src/config/env.mjs';
test('Private service addressing and configurable port validation', () => {
  assert.equal(
    ollamaEndpoint({ host: 'host.docker.internal', port: '11434' }),
    'http://host.docker.internal:11434',
  );
  assert.equal(ollamaEndpoint({ host: 'ollama', port: '12000' }), 'http://ollama:12000');
  assert.equal(ollamaEndpoint({ host: '::1', port: '11434' }), 'http://[::1]:11434');
  assert.equal(parsePort('9090', 'PORT'), 9090);
  for (const port of ['0', '65536', 'abc', '-1', '8787.5'])
    assert.throws(() => parsePort(port, 'PORT'));
  assert.throws(() => ollamaEndpoint({ host: 'https://example.com' }), /hostname or IP/);
});
