import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Store } from '../src/repositories/sqlite_store.mjs';
import { EditorialPolicy, EDITORIAL_VERSION } from '../src/services/editorial.mjs';
import { checkSummary } from '../src/services/publication.mjs';

const [snapshot, casesFile, output] = process.argv.slice(2);
if (!snapshot || !casesFile || !output)
  throw Error('Usage: node scripts/audit_pilot.mjs snapshot.json cases.json report.json');
const raw = readFileSync(snapshot);
const dataset = JSON.parse(raw);
const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
const store = new Store(':memory:');
const policy = new EditorialPolicy({ store, mode: 'laya', dedup: 'off' });
const results = [];
try {
  for (const item of cases.cases) {
    const original = dataset.articles.find((a) => a.id === item.id);
    if (!original?.contentText) throw Error(`Snapshot missing body: ${item.id}`);
    const started = Date.now();
    try {
      const evaluated = await policy.evaluate({ ...original, editorialReviewed: false });
      results.push({
        id: item.id,
        title: original.title,
        expectedScope: item.expectedScope,
        previousStatus: original.editorialStatus,
        status: evaluated.editorialStatus,
        score: evaluated.editorialScore,
        decision: store.decisions().find((d) => d.articleId === item.id),
        summaryQuality: checkSummary(original),
        durationMs: Date.now() - started,
      });
    } catch (_) {
      results.push({
        id: item.id,
        status: 'error',
        expectedScope: item.expectedScope,
        durationMs: Date.now() - started,
      });
    }
    console.log(JSON.stringify(results.at(-1)));
    writeFileSync(
      output,
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          snapshotSha256: createHash('sha256').update(raw).digest('hex'),
          version: EDITORIAL_VERSION,
          provenance: cases.provenance,
          plannedCases: cases.cases.length,
          results,
          note: 'Selected diagnostic cases assessed by Codex, not independent human labels or a representative benchmark. No production precision or recall claim.',
        },
        null,
        2,
      ),
    );
  }
  if (results.some((r) => r.status === 'error')) process.exitCode = 1;
} finally {
  store.close();
}
