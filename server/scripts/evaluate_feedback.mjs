// Offline replay only: input files and report/cache output, never a live Store.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { assessFocus } from '../src/services/focus.mjs';

const [
  datasetPath,
  manifestPath,
  outputPath,
  policyPath = fileURLToPath(new URL('../src/services/editorial.mjs', import.meta.url)),
] = process.argv.slice(2);
if (!datasetPath || !manifestPath || !outputPath)
  throw Error(
    'Usage: node scripts/evaluate_feedback.mjs dataset.json manifest.json report.json [policy.mjs]',
  );
const { EditorialPolicy, LayaClient, EDITORIAL_VERSION } = await import(
  pathToFileURL(resolve(policyPath)).href
);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const raw = readFileSync(datasetPath),
  manifestRaw = readFileSync(manifestPath);
const dataset = JSON.parse(raw),
  manifest = JSON.parse(manifestRaw);
const identity = {
  version: EDITORIAL_VERSION,
  policyHash: hash(
    Buffer.concat([
      readFileSync(policyPath),
      readFileSync(new URL('../src/services/focus.mjs', import.meta.url)),
    ]),
  ),
  datasetHash: hash(raw),
  manifestHash: hash(manifestRaw),
};
const previous = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath)) : null;
if (previous && Object.keys(identity).some((key) => previous[key] !== identity[key]))
  throw Error('Report belongs to a different policy/dataset/manifest');
const results = previous?.results ?? [];
const articles = new Map(dataset.articles.map((a) => [a.id, a]));
const cache = new Map(dataset.cache ?? []);
const decisions = new Map();
const lowCachePath = outputPath + '.predictions.json';
const lowCache = new Map(existsSync(lowCachePath) ? JSON.parse(readFileSync(lowCachePath)) : []);
const atomic = (path, value) => {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(path + '.tmp', path);
};
const client = new LayaClient();
const predict = client.predict.bind(client);
let requests = 0;
client.predict = async (state, schema) => {
  const key = hash(JSON.stringify([client.revision, state, schema]));
  if (lowCache.has(key)) return lowCache.get(key);
  const response = await predict(state, schema);
  requests++;
  lowCache.set(key, response);
  atomic(lowCachePath, [...lowCache]);
  return response;
};
const store = {
  cached: (key) => cache.get(key),
  cache: (key, value) => cache.set(key, value),
  recordDecision: (id, d) => decisions.set(id, d),
};
const policy = new EditorialPolicy({ store, client, mode: 'laya', dedup: 'off' });
for (const item of manifest.cases) {
  if (results.some((r) => r.id === item.id && !r.error)) continue;
  const article = articles.get(item.id);
  const started = Date.now(),
    before = requests;
  let row = { id: item.id, expected: item.expected, split: item.split };
  if (item.excludeReason) row = { ...row, status: 'not_evaluated', diagnostic: item.excludeReason };
  else if (!article?.contentText?.trim())
    row = {
      ...row,
      status: 'unavailable',
      diagnostic: 'missing_original_text',
      ...(item.expected === 'unlabeled' ? {} : { error: 'missing_original_text' }),
    };
  else
    try {
      const evaluated = await policy.evaluate({
        ...article,
        abstract: '',
        editorialReviewed: false,
      });
      const focus = assessFocus({ ...article, abstract: '' }, { full: true });
      row = {
        ...row,
        title: article.title,
        bodyHash: hash(article.contentText),
        characters: article.contentText.length,
        status: evaluated.editorialStatus,
        score: evaluated.editorialScore,
        decision: decisions.get(item.id),
        ruleAccepted: focus.accepted,
        ruleReason: focus.reason,
        eligible: evaluated.editorialStatus === 'accepted' && focus.accepted,
      };
    } catch (error) {
      row = { ...row, status: 'error', error: error.message };
    }
  row.durationMs = Date.now() - started;
  row.requests = requests - before;
  const old = results.findIndex((r) => r.id === item.id);
  if (old >= 0) results[old] = row;
  else results.push(row);
  atomic(outputPath, {
    ...identity,
    generatedAt: new Date().toISOString(),
    provenance: manifest.provenance,
    planned: manifest.cases.length,
    results,
    note: 'Selected human-reviewed cases, offline replay only. No production precision/recall claim. Eligibility checks scope and editorial decision only, not quotas, duplicates or summary quality.',
  });
  console.log(
    JSON.stringify({
      completed: results.filter((result) => !result.error).length,
      total: manifest.cases.length,
      id: row.id,
      status: row.status,
      score: row.score,
      requests: row.requests,
      error: row.error,
    }),
  );
}
if (results.some((r) => r.error)) process.exitCode = 1;
