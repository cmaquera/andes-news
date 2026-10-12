import { ArticleExtractor } from '../src/services/article_extractor.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const exported = process.argv.includes('--export');
const urls = process.argv.slice(2).filter((v) => v !== '--export');
if (!urls.length) throw Error('Supply a public article URL');
const extractor = new ArticleExtractor();
for (const url of urls) {
  try {
    const a = await extractor.extract(url);
    if (exported) {
      mkdirSync('build', { recursive: true });
      writeFileSync(
        'build/preview-article.json',
        JSON.stringify({
          id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          url,
          title: a.title,
          titleEs: a.title,
          sourceId: 'genbeta',
          region: 'Global',
          topic: 'Tecnología',
          status: 'processing',
          coverage: a.coverage,
          language: a.language,
          author: a.author,
          wordCount: a.wordCount,
          content: a.blocks,
        }),
      );
    }
    console.log(
      JSON.stringify(
        {
          url,
          title: a.title,
          wordCount: a.wordCount,
          coverage: a.coverage,
          blocks: a.blocks.length,
          lastParagraph: a.blocks.at(-1)?.text.slice(-300),
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.log(JSON.stringify({ url, error: e.code ?? e.message }));
  }
}
