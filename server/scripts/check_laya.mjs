import { LayaClient } from '../src/services/editorial.mjs';
const client = new LayaClient();
const started = Date.now();
const result = await client.predict({
  title: 'Python interpreter release',
  text: 'Python adds a documented interpreter API for extension authors with concrete migration examples and benchmark results for software engineers.',
});
console.log(
  JSON.stringify(
    { ok: true, durationMs: Date.now() - started, modelRevision: client.revision, ...result },
    null,
    2,
  ),
);
