import { readFileSync, writeFileSync } from 'node:fs';
import { Store } from '../src/repositories/sqlite_store.mjs';
import { assessFocus } from '../src/services/focus.mjs';
import { EditorialPolicy } from '../src/services/editorial.mjs';

const [dataset, output] = process.argv.slice(2);
if (!dataset || !output)
  throw Error('Usage: node scripts/evaluate_editorial.mjs labeled.jsonl report.json');
const rows = readFileSync(dataset, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
if (
  !rows.length ||
  rows.some(
    (r) =>
      typeof r.valuable !== 'boolean' ||
      typeof r.title !== 'string' ||
      typeof r.contentText !== 'string',
  )
)
  throw Error('Each row needs title, contentText and human valuable:boolean label');
const store = new Store(':memory:');
const policy = new EditorialPolicy({ store, mode: 'laya', dedup: 'off' });
const results = [];
const metrics = (field) => {
  let tp = 0,
    fp = 0,
    fn = 0,
    review = 0;
  for (const r of results) {
    const accepted = r[field] === 'accepted';
    if (r[field] === 'review' || r[field] === 'error') review++;
    if (accepted && r.valuable) tp++;
    if (accepted && !r.valuable) fp++;
    if (!accepted && r.valuable) fn++;
  }
  return {
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    tp,
    fp,
    fn,
    review,
  };
};
try {
  for (const [index, row] of rows.entries()) {
    const article = { ...row, id: String(index), sourceId: row.sourceId ?? 'evaluation' };
    const rules = assessFocus(article, { full: true });
    try {
      const decision = await policy.evaluate(article);
      results.push({
        index,
        valuable: row.valuable,
        sourceType: row.sourceType ?? 'unknown',
        rules: rules.accepted ? 'accepted' : 'rejected',
        laya: decision.editorialStatus,
        score: decision.editorialScore,
      });
    } catch (_) {
      results.push({
        index,
        valuable: row.valuable,
        rules: rules.accepted ? 'accepted' : 'rejected',
        laya: 'error',
      });
    }
  }
  const report = {
    measuredAt: new Date().toISOString(),
    datasetRows: rows.length,
    modelRevision: policy.client.revision,
    rules: metrics('rules'),
    laya: metrics('laya'),
    results,
    note: 'Human labels required. This measures classification, not factual accuracy, deduplication or production latency.',
  };
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({ rows: rows.length, rules: report.rules, laya: report.laya, output }),
  );
  if (results.some((r) => r.laya === 'error')) process.exitCode = 1;
} finally {
  store.close();
}
