import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { ArticleExtractor } from '../src/services/article_extractor.mjs';
import { arxivIdentity } from '../src/services/arxiv.mjs';

// Targeted refresh of already prepared papers. Compare-and-swap avoids
// overwriting a concurrent worker/review; no state reset or publication.
const path = process.env.DATABASE_PATH;
const ids =
  process.argv
    .find((a) => a.startsWith('--ids='))
    ?.slice(6)
    .split(',') ?? [];
const apply = process.argv.includes('--apply');
if (!path || !ids.length || ids.some((id) => !/^[a-f0-9]{32}$/.test(id)))
  throw Error('Set DATABASE_PATH and --ids=id1,id2; dry run unless --apply');
const db = new DatabaseSync(path);
db.exec('PRAGMA busy_timeout=5000');
try {
  const rows = ids.map((id) => db.prepare('SELECT id,data,state FROM articles WHERE id=?').get(id));
  if (rows.some((r) => !r || r.state !== 'ready' || !arxivIdentity(JSON.parse(r.data).url)))
    throw Error('Only prepared arXiv articles can be refreshed');
  if (apply) {
    const backup = `${path}.before-paper-upgrade-${Date.now()}.db`;
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    chmodSync(backup, 0o600);
    console.log(JSON.stringify({ backup }));
  }
  const extractor = new ArticleExtractor();
  for (const row of rows) {
    const article = JSON.parse(row.data);
    const body = await extractor.extract(article.url);
    const refreshed = {
      ...article,
      paper: body.paper,
      content: body.blocks,
      contentText: body.text,
      translatedContent: [],
      contentScope: body.contentScope,
      // The previous summary was based on the landing page, not this new body.
      summaryScope: article.summaryScope || article.contentScope || 'arxiv_abstract',
      coverage: body.coverage,
      author: body.author,
      wordCount: body.wordCount,
      resolvedUrl: body.resolvedUrl,
      fetchedAt: body.fetchedAt,
      extractionMethod: body.extractionMethod,
      extractionVersion: body.extractionVersion,
      paperHtmlError: body.paperHtmlError,
    };
    const changed = apply
      ? db
          .prepare("UPDATE articles SET data=?,updated=? WHERE id=? AND data=? AND state='ready'")
          .run(JSON.stringify(refreshed), Date.now(), row.id, row.data).changes === 1
      : false;
    console.log(
      JSON.stringify({
        id: row.id,
        apply,
        changed,
        wordCount: body.wordCount,
        contentScope: body.contentScope,
        paper: body.paper,
        paperHtmlError: body.paperHtmlError,
        summaryScope: refreshed.summaryScope,
        published: false,
      }),
    );
  }
} finally {
  db.close();
}
