import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scientificDocuments,
  resolveScientificReferences,
  MAX_PAPER_REFERENCES,
} from '../src/services/scientific_documents.mjs';
import { ArticleExtractor } from '../src/services/article_extractor.mjs';
import { Store } from '../src/repositories/sqlite_store.mjs';
import { Collector } from '../src/jobs/collector.mjs';

const prose =
  'Python software engineering research evaluates compiler changes with reproducible benchmarks and documented limitations. '.repeat(
    12,
  );
const html = (head = '', body = '') =>
  `<html><head><title>Software research</title>${head}</head><body><article><p>${prose}</p>${body}</article></body></html>`;
const meta = (values) =>
  Object.entries(values)
    .map(([k, v]) => `<meta name="${k}" content="${v}">`)
    .join('');
const paper = (values = {}, body = '') =>
  html(
    meta({ citation_title: 'Compiler research', citation_author: 'Ada Example', ...values }),
    body,
  );
const url = 'https://journal.example/papers/one';

test('Generic publisher metadata discovers PDF and alternate full HTML without a repository allowlist', () => {
  const found = scientificDocuments(
    paper(
      { citation_pdf_url: '/pdf/one.pdf', citation_doi: '10.1234/one' },
      '<a href="/full/one">Full text HTML</a><a href="/supplement.pdf">Supplementary PDF</a>',
    ),
    url,
  );
  assert.equal(found.paper.pdfUrl, 'https://journal.example/pdf/one.pdf');
  assert.equal(found.paper.htmlUrl, 'https://journal.example/full/one');
  assert.equal(found.paper.doi, '10.1234/one');
  assert.equal(found.author, 'Ada Example');
  assert.deepEqual(found.references, []);
});

test('Institutional Dublin Core and schema.org scholarly documents expose formats', () => {
  const dc = scientificDocuments(
    html(
      meta({
        'DC.title': 'A software thesis',
        'DC.type': 'Thesis',
        'DC.creator': 'Ada',
        'DC.identifier': 'http://archive.example/thesis.pdf',
      }),
      '<a href="/text">HTML</a>',
    ),
    'https://archive.example/record/1',
  );
  assert.equal(dc.paper.pdfUrl, 'http://archive.example/thesis.pdf');
  assert.equal(dc.paper.htmlUrl, 'https://archive.example/text');
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: 'A compiler study',
    url,
    identifier: { value: '10.1234/compiler' },
    encoding: [
      { encodingFormat: 'application/pdf', contentUrl: '/paper.pdf' },
      { encodingFormat: 'text/html', contentUrl: '/full' },
    ],
  };
  const found = scientificDocuments(
    html(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`),
    url,
  );
  assert.equal(found.paper.pdfUrl, 'https://journal.example/paper.pdf');
  assert.equal(found.paper.htmlUrl, 'https://journal.example/full');
});

test('A DOI or abstract landing page is not mislabeled as full HTML', () => {
  const found = scientificDocuments(paper({ citation_pdf_url: '/paper.pdf' }), url);
  assert.equal(found.paper.htmlUrl, '');
  assert.equal(
    scientificDocuments(
      html('<meta name="DC.title" content="News headline">', '<a href="/brochure.pdf">PDF</a>'),
      url,
    ).paper,
    null,
  );
});

test('A journal-name anchor is recognized from its scientific sentence, without requiring the name of a repository', () => {
  const found = scientificDocuments(
    html(
      '',
      '<p>Un estudio publicado en <a href="https://unknown-journal.example/study/17">Revista de Software</a> describe el método.</p>',
    ),
    'https://news.example/story',
  );
  assert.equal(found.references[0].url, 'https://unknown-journal.example/study/17');
  assert.equal(found.references[0].title, 'Revista de Software');
});

test('Discovery is bounded, excludes navigation and resolves only explicit scientific links', async () => {
  const links =
    '<nav><a href="https://other.example/nav">Research</a></nav><a href="/manual.pdf">Manual PDF</a><a href="https://journal.example/paper">The study</a><a href="https://doi.org/10.1234/one">Results</a><a href="https://archive.example/preprint">Research paper</a><a href="https://ignored.example/extra">Another study</a>';
  const page = { url: 'https://news.example/story', body: html('', links) };
  const requested = [];
  const found = await resolveScientificReferences(page, {
    robots: { allowed: async () => {} },
    get: async (u) => {
      requested.push(u);
      return {
        url: u,
        type: 'text/html',
        body: paper({ citation_pdf_url: '/one.pdf', citation_doi: '10.1234/one' }),
      };
    },
  });
  assert.equal(requested.length, MAX_PAPER_REFERENCES);
  assert.equal(found.papers.length, 1); // One DOI, several references to it.
  assert.equal(found.papers[0].relation, 'reference');
  assert.ok(!requested.some((u) => /manual|nav|ignored/.test(u)));
});

test('News retains its body while related DOI and PDF documents are returned separately', async () => {
  const story = html(
    '',
    '<h2>Journalist analysis</h2><a href="https://doi.org/10.1234/one">The study</a><a href="https://university.example/research.pdf">Research paper</a>',
  );
  const extractor = new ArticleExtractor({
    robots: { allowed: async () => {} },
    get: async (u, options) => {
      if (u === 'https://news.example/story') return { url: u, type: 'text/html', body: story };
      if (u.endsWith('.pdf')) {
        assert.equal(options.metadataForPdf, true);
        return { url: u, type: 'application/pdf', body: '' };
      }
      return {
        url,
        type: 'text/html',
        body: paper({ citation_pdf_url: '/paper.pdf', citation_fulltext_html_url: '/full' }),
      };
    },
  });
  const body = await extractor.extract('https://news.example/story');
  assert.match(body.text, /Journalist analysis/);
  assert.equal(body.resolvedUrl, 'https://news.example/story');
  assert.equal(body.papers.length, 2);
  assert.equal(body.papers[0].htmlUrl, 'https://journal.example/full');
  assert.equal(body.papers[1].pdfUrl, 'https://university.example/research.pdf');
  assert.equal(body.paper, undefined);
});

test('Own scholarly document prefers advertised full HTML; mismatching DOI falls back to its record', async () => {
  for (const wrong of [false, true]) {
    const extractor = new ArticleExtractor({
      robots: { allowed: async () => {} },
      get: async (u) => ({
        url: u,
        type: 'text/html',
        body:
          u === url
            ? paper({
                citation_doi: '10.1234/one',
                citation_pdf_url: '/paper.pdf',
                citation_fulltext_html_url: '/full',
              })
            : paper(
                { citation_doi: wrong ? '10.1234/other' : '10.1234/one' },
                '<h2>Full evaluation section</h2>',
              ),
      }),
    });
    const result = await extractor.extract(url);
    assert.equal(result.contentScope, wrong ? 'paper_record' : 'paper');
    assert.equal(result.coverage, wrong ? 'partial' : 'extracted');
    assert.equal(result.text.includes('Full evaluation section'), !wrong);
    if (wrong) assert.equal(result.paperHtmlError, 'paper_identity_mismatch');
  }
});

test('Private URLs, scripts, unrelated citations and failed publishers cannot replace news', async () => {
  const page = {
    url: 'https://news.example/story',
    body: html(
      '',
      '<a href="http://127.0.0.1/secret">Research paper</a><a href="javascript:alert(1)">Study</a><a href="https://blocked.example/study">Research</a>',
    ),
  };
  const requests = [];
  const found = await resolveScientificReferences(page, {
    robots: {
      allowed: async () => {
        throw Object.assign(Error('denied'), { code: 'robots_denied' });
      },
    },
    get: async (u) => {
      requests.push(u);
    },
  });
  assert.deepEqual(requests, []);
  assert.deepEqual(found.papers, []);
  assert.equal(found.failures.length, 1);
  const unsafe = scientificDocuments(
    paper({
      citation_pdf_url: 'http://169.254.169.254/latest',
      citation_fulltext_html_url: 'file:///etc/passwd',
    }),
    url,
  );
  assert.equal(unsafe.paper.pdfUrl, '');
  assert.equal(unsafe.paper.htmlUrl, '');
});

test('NewsArticle citation JSON-LD discovers the cited paper without becoming that paper', () => {
  const json = {
    '@type': 'NewsArticle',
    headline: 'News',
    citation: { '@type': 'ScholarlyArticle', name: 'Compiler paper', url },
  };
  const found = scientificDocuments(
    html(`<script type="application/ld+json">${JSON.stringify(json)}</script>`),
    'https://news.example/story',
  );
  assert.equal(found.paper, null);
  assert.equal(found.references[0].url, url);
});

test('Native posts can expose scientific references while unrelated URLs trigger no lookup', async () => {
  const fetched = [];
  const extractor = new ArticleExtractor({
    robots: { allowed: async () => {} },
    get: async (u) => {
      fetched.push(u);
      return { url: u, type: 'text/html', body: paper({ citation_pdf_url: '/paper.pdf' }) };
    },
  });
  const empty = await extractor.nativeReferences(
    'A software release at https://product.example/release',
    'https://social.example/post/1',
  );
  assert.deepEqual(empty, []);
  assert.equal(fetched.length, 0);
  const found = await extractor.nativeReferences(
    'New research paper: https://university.example/study.',
    'https://social.example/post/2',
  );
  assert.equal(found[0].pdfUrl, 'https://university.example/paper.pdf');
  assert.equal(found[0].relation, 'reference');
});

test('Direct PDF remains accessible without fabricating extracted text or generating a summary', async (t) => {
  const extractor = new ArticleExtractor({
    robots: { allowed: async () => {} },
    get: async (u, options) => {
      assert.equal(options.metadataForPdf, true);
      return { url: u, type: 'application/pdf', body: '' };
    },
  });
  const store = new Store(':memory:');
  t.after(() => store.close());
  const a = store.discover({
    url: 'https://university.example/paper.pdf',
    title: 'Python compiler research',
    sourceId: 'hn',
    region: 'Global',
  }).article;
  const collector = new Collector({
    store,
    extractor,
    model: {
      summarize: async () => {
        throw Error('Unread PDF must not reach the model');
      },
    },
  });
  await collector.processOne();
  const result = store.get(a.id);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.papers[0].pdfUrl, a.url);
  assert.equal(result.contentText, '');
  assert.equal(result.abstract, '');
});
