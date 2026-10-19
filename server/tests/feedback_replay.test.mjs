import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

test('Offline feedback replay preserves inputs, resumes results and rejects a changed manifest', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'andes-replay-'));
  let requests = 0;
  const http = createServer(async (req, res) => {
    requests++;
    let text = '';
    for await (const part of req) text += part;
    const payload = JSON.parse(text);
    const answers = Object.fromEntries(
      Object.entries(payload.questions).map(([name, q]) => [
        name,
        q.type === 'choice'
          ? { choice: 'software', probabilities: { software: 0.9, ai: 0.05, other: 0.05 } }
          : { noul: 0.95 },
      ]),
    );
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ answers }));
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => http.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  const input = join(dir, 'dataset.json'),
    manifest = join(dir, 'manifest.json'),
    output = join(dir, 'report.json');
  writeFileSync(
    input,
    JSON.stringify({
      articles: [
        {
          id: 'a',
          title: 'Python API release',
          contentText:
            'A Python software release with concrete API changes and migration guidance for developers. '.repeat(
              5,
            ),
        },
      ],
    }),
  );
  writeFileSync(
    manifest,
    JSON.stringify({
      provenance: 'Synthetic test fixture',
      cases: [{ id: 'a', expected: 'accept', split: 'adjustment' }],
    }),
  );
  const original = readFileSync(input);
  const args = [
    fileURLToPath(new URL('../scripts/evaluate_feedback.mjs', import.meta.url)),
    input,
    manifest,
    output,
  ];
  const env = {
    ...process.env,
    LAYA_URL: `http://127.0.0.1:${http.address().port}`,
    LAYA_REVISION: 'test-fixture',
  };
  await execute(process.execPath, args, { env });
  const report = JSON.parse(readFileSync(output));
  assert.equal(report.results[0].eligible, true);
  assert.match(report.policyHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(readFileSync(input), original);
  const count = requests;
  await execute(process.execPath, args, { env });
  assert.equal(requests, count);
  assert.deepEqual(JSON.parse(readFileSync(output)), report);
  writeFileSync(
    manifest,
    JSON.stringify({ cases: [{ id: 'a', expected: 'reject', split: 'adjustment' }] }),
  );
  await assert.rejects(
    execute(process.execPath, args, { env }),
    /different policy\/dataset\/manifest/,
  );
  assert.equal(requests, count);
  assert.deepEqual(JSON.parse(readFileSync(output)), report);
});
