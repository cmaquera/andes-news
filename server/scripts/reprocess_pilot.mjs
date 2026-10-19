import { Store } from '../src/repositories/sqlite_store.mjs';

// Offline maintenance: stop the API worker before --apply. Does not publish.
if (!process.env.DATABASE_PATH) throw Error('Set DATABASE_PATH; stop Andes before maintenance.');
const ids =
  process.argv
    .find((a) => a.startsWith('--ids='))
    ?.slice(6)
    .split(',') ?? [];
if (!ids.length || ids.some((id) => !/^[a-f0-9]{32}$/.test(id)) || new Set(ids).size !== ids.length)
  throw Error('Provide unique article IDs with --ids=id1,id2');
const apply = process.argv.includes('--apply');
const store = new Store(process.env.DATABASE_PATH);
try {
  const articles = ids.map((id) => store.get(id));
  if (articles.some((a) => !a?.ingestionShadow || a.editorialReviewed || !a.contentText))
    throw Error('Only unreviewed shadow documents with recovered bodies are eligible');
  if (apply) {
    store.db.exec('BEGIN IMMEDIATE');
    try {
      for (const a of articles) {
        const next = { ...a, abstract: '', titleEs: '', keyPoints: [], status: 'queued' };
        for (const field of [
          'editorialStatus',
          'editorialScore',
          'evaluationVersion',
          'summaryQuality',
          'summaryReviewedAt',
          'duplicateCandidateOf',
          'duplicateOf',
          'dedupMethod',
        ])
          delete next[field];
        next.relevance = { ...a.relevance, accepted: true, reason: 'pending_editorial' };
        store.save(next, 'queued');
        store.db.prepare('UPDATE articles SET attempts=0,retry_at=0 WHERE id=?').run(a.id);
      }
      store.db.exec('COMMIT');
    } catch (error) {
      store.db.exec('ROLLBACK');
      throw error;
    }
  }
  console.log(JSON.stringify({ apply, ids, published: false }));
} finally {
  store.close();
}
