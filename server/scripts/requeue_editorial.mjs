import { Store } from '../src/repositories/sqlite_store.mjs';
import { assessFocus } from '../src/services/focus.mjs';

if (!process.env.DATABASE_PATH) throw Error('Set DATABASE_PATH. Stop Andes before maintenance.');
const store = new Store(process.env.DATABASE_PATH);
try {
  const apply = process.argv.includes('--apply');
  const promote = process.argv.includes('--promote-shadow');
  const resetRules = process.argv.includes('--rules');
  const rows = store.db.prepare('SELECT data FROM articles').all();
  let eligible = 0;
  if (apply) store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const article = JSON.parse(row.data);
      if (article.ingestionShadow && !promote) continue;
      eligible++;
      if (!apply) continue;
      const relevance = assessFocus(article, { full: Boolean(article.contentText) });
      delete article.duplicateOf;
      delete article.duplicateCandidateOf;
      delete article.dedupMethod;
      delete article.editorialStatus;
      delete article.editorialReviewed;
      article.ingestionShadow = false;
      article.relevance = resetRules
        ? relevance
        : { ...relevance, accepted: true, reason: 'pending_editorial' };
      store.save(article, resetRules && !relevance.accepted ? 'filtered' : 'queued');
      store.db.prepare('UPDATE articles SET attempts=0,retry_at=0 WHERE id=?').run(article.id);
    }
    if (apply) store.db.exec('COMMIT');
  } catch (error) {
    if (apply) store.db.exec('ROLLBACK');
    throw error;
  }
  console.log(JSON.stringify({ apply, promote, resetRules, eligible }));
} finally {
  store.close();
}
