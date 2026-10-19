import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Store, canonicalUrl } from '../src/repositories/sqlite_store.mjs';
import { ArticleExtractor } from '../src/services/article_extractor.mjs';
import { arxivFormats } from '../src/services/arxiv.mjs';
import { sourceIdentity } from '../src/services/source_identity.mjs';
import { createApi } from '../src/app.mjs';
import { Collector } from '../src/jobs/collector.mjs';

const token = 'reader-test-token-with-at-least-32-characters';
const abs = 'https://arxiv.org/abs/2610.18861';
const prose =
  'This paper describes a Python software agent implementation, benchmark methodology and documented limitations. '.repeat(
    15,
  );
const record = (links = '') =>
  `<html><head><title>Software agents</title><meta name="citation_author" content="Ada Example"></head><body><article><h1>Software agents</h1><p>${prose}</p>${links}</article></body></html>`;

test('Horizon-managed publishers are not fetched a second time by the legacy collector', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const fetched = [];
  const collector = new Collector({
    store,
    managedSources: ['hn', 'genbeta', 'github'],
    load: async (s) => {
      fetched.push(s.id);
      return [];
    },
  });
  await collector.discover();
  assert.deepEqual(fetched, ['gestion', 'xataka-mx', 'dev']);
});

test('One publisher per catalog, old connector IDs become aliases, unrelated feeds stay distinct', async (t) => {
  const store = new Store(':memory:');
  const app = createApi({ store, apiToken: token });
  t.after(async () => {
    await app.close();
    store.close();
  });
  const oldHn = 'horizon:hackernews:old';
  const genbeta = `rss:Genbeta:${createHash('sha256').update('https://www.genbeta.com/rss2.xml').digest('hex').slice(0, 12)}`;
  for (const [index, sourceType, sourceId, sourceName] of [
    [1, 'hackernews', oldHn, 'hackernews'],
    [2, 'rss', 'horizon:rss:old', genbeta],
    [3, 'rss', 'horizon:rss:another', 'rss:Genbeta:aaaaaaaaaaaa'],
  ]) {
    const article = store.discover({
      title: 'Python software release',
      sourceId,
      sourceType,
      sourceName,
      url: `https://example.com/${index}`,
      region: 'Global',
    }).article;
    store.db
      .prepare('INSERT INTO source_occurrences VALUES(?,?,?,?,?)')
      .run(
        `instance-${index}`,
        'post',
        article.id,
        JSON.stringify({ sourceId, sourceType, sourceName, sourceUrl: article.url }),
        Date.now(),
      );
  }
  const catalog = (
    await app.inject({ url: '/sources', headers: { authorization: `Bearer ${token}` } })
  ).json().sources;
  assert.equal(catalog.filter((s) => s.id === 'hn').length, 1);
  assert.deepEqual(catalog.find((s) => s.id === 'hn').aliases, [oldHn]);
  assert.deepEqual(catalog.find((s) => s.id === 'genbeta').aliases, ['horizon:rss:old']);
  assert.equal(catalog.find((s) => s.id === 'horizon:rss:another').name, 'Genbeta');
  assert.equal(store.list().filter((a) => a.sourceId === 'hn').length, 1);
  assert.equal(
    store.list().find((a) => a.sourceId === 'hn').sourceOccurrences[0].sourceName,
    'Hacker News',
  );
  assert.equal(
    sourceIdentity({
      sourceType: 'rss',
      sourceFeedUrl: 'https://www.genbeta.com/rss2.xml',
      sourceInstanceId: 'rss:renamed',
      sourceName: 'Custom name',
    }).id,
    'genbeta',
  );
  assert.notEqual(
    sourceIdentity({
      sourceType: 'github',
      sourceInstanceId: 'github:python',
      sourceName: 'Python releases',
    }).id,
    'github',
  );
});

test('arXiv abstract, HTML and PDF share a document; distinct versions remain separate', () => {
  assert.equal(canonicalUrl(`${abs}?utm_source=hn`), abs);
  assert.equal(canonicalUrl('http://www.arxiv.org/pdf/2610.18861.pdf'), abs);
  assert.equal(canonicalUrl('https://arxiv.org/html/2610.18861v1'), `${abs}v1`);
  assert.notEqual(canonicalUrl(`${abs}v1`), canonicalUrl(`${abs}v2`));
  assert.equal(
    canonicalUrl('https://arxiv.org/pdf/cs/9901001.pdf'),
    'https://arxiv.org/abs/cs/9901001',
  );
  assert.equal(
    arxivFormats(
      record(
        '<a href="https://evil.example/html/2610.18861">HTML</a><a href="/html/2610.99999">Other paper</a>',
      ),
      abs,
    ).paper.htmlUrl,
    undefined,
  );
  assert.equal(
    arxivFormats(record('<a href="/html/2610.18861v2">New version</a>'), `${abs}v1`).paper.htmlUrl,
    undefined,
  );
});

test('arXiv uses advertised full HTML and retains links, authors and tables', async () => {
  const urls = [],
    checks = [];
  const htmlUrl = 'https://arxiv.org/html/2610.18861v1';
  const extractor = new ArticleExtractor({
    robots: { allowed: async (u) => checks.push(u) },
    get: async (u) => {
      urls.push(u);
      return {
        url: u,
        type: 'text/html',
        body:
          u === abs
            ? record('<a href="/pdf/2610.18861">PDF</a><a href="/html/2610.18861v1">HTML</a>')
            : record(
                `<h2>Full evaluation</h2><p>${prose}</p><table><tr><th>Model</th><th>Score</th></tr><tr><td>Agent</td><td>95</td></tr></table>`,
              ),
      };
    },
  });
  const article = await extractor.extract('https://arxiv.org/pdf/2610.18861');
  assert.deepEqual(urls, [abs, htmlUrl]);
  assert.ok(checks.includes(htmlUrl));
  assert.equal(article.paper.pdfUrl, 'https://arxiv.org/pdf/2610.18861');
  assert.equal(article.paper.htmlUrl, htmlUrl);
  assert.equal(article.author, 'Ada Example');
  assert.equal(article.contentScope, 'paper');
  assert.equal(article.resolvedUrl, htmlUrl);
  assert.ok(article.blocks.some((b) => b.type === 'table'));
});

test('Missing or failed arXiv HTML keeps PDF and honestly marks abstract-only coverage', async () => {
  for (const html of [false, true]) {
    const extractor = new ArticleExtractor({
      robots: { allowed: async () => {} },
      get: async (u) => {
        if (u !== abs) throw Object.assign(Error('denied'), { code: 'http_403' });
        return {
          url: u,
          type: 'text/html',
          body: record(
            `<a href="/pdf/2610.18861">PDF</a>${html ? '<a href="/html/2610.18861">HTML</a>' : ''}`,
          ),
        };
      },
    });
    const result = await extractor.extract(abs);
    assert.equal(result.coverage, 'partial');
    assert.equal(result.contentScope, 'arxiv_abstract');
    assert.ok(result.paper.pdfUrl);
    assert.equal(Boolean(result.paper.htmlUrl), html);
    if (html) assert.equal(result.paperHtmlError, 'http_403');
  }
});

test('Identical bodies from different URLs are filtered even with the pilot in shadow', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const first = store.discover({
    title: 'Python software agents',
    url: 'https://example.com/first',
    sourceId: 'hn',
    region: 'Global',
  }).article;
  store.save({ ...first, contentText: prose }, 'ready');
  const second = store.discover({
    title: 'Python software agents',
    url: 'https://example.com/second',
    sourceId: 'genbeta',
    region: 'Global',
    contentText: prose,
  }).article;
  const collector = new Collector({
    store,
    editorial: { mode: 'shadow', evaluate: async (a) => ({ ...a, editorialStatus: 'accepted' }) },
    extractor: {
      extract: async () => ({ text: prose, blocks: [{ type: 'paragraph', text: prose }] }),
    },
    model: {
      summarize: async () => {
        throw Error('No inference for exact duplicates');
      },
    },
  });
  await collector.processOne();
  assert.equal(store.get(second.id).duplicateOf, first.id);
  assert.equal(store.get(second.id).status, 'filtered');
  assert.equal(store.list().length, 1);
});
