import test from 'node:test';
import assert from 'node:assert/strict';
import { ArticleExtractor } from '../src/services/article_extractor.mjs';
import { Collector } from '../src/jobs/collector.mjs';
import { Store } from '../src/repositories/sqlite_store.mjs';
import { readerArticle } from '../src/services/reading_policy.mjs';
import { OllamaModel } from '../src/services/ollama.mjs';

const authorAbstract =
  'This Python compiler research introduces an optimization method and evaluates the implementation with reproducible benchmarks. The authors report improvements and describe limitations of their software engineering approach.';
const record = (abstract = authorAbstract) =>
  `<html><head><meta name="citation_title" content="Python compiler research"><meta name="citation_author" content="Ada"><meta name="citation_pdf_url" content="/paper.pdf"><meta name="citation_fulltext_html_url" content="/full"></head><body><div class="abstract">${abstract}</div><article><h2>Full paper</h2><p>Unwanted formula and appendix content.</p></article></body></html>`;

test('Scientific preparation summarizes the authors abstract in Spanish and skips reconstruction and translation', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const a = store.discover({
    title: 'Python compiler research',
    url: 'https://journal.example/paper',
    sourceId: 'hn',
    region: 'Global',
  }).article;
  const fetched = [];
  let summaries = 0;
  const collector = new Collector({
    store,
    extractor: new ArticleExtractor({
      robots: { allowed: async () => {} },
      get: async (url) => {
        fetched.push(url);
        return { url, type: 'text/html', body: record() };
      },
    }),
    editorial: {
      mode: 'rules',
      evaluate: async (a) => ({ ...a, relevance: { ...a.relevance, accepted: true } }),
    },
    model: {
      summarize: async (title, text, options) => {
        summaries++;
        assert.equal(text, authorAbstract);
        assert.equal(options.scientific, true);
        return {
          titleEs: 'Investigación sobre compiladores Python',
          abstract:
            'Los autores presentan una optimización del compilador y evalúan sus resultados mediante pruebas reproducibles.',
          keyPoints: ['Objetivo: optimizar el compilador.'],
        };
      },
      translate: async () => {
        throw Error('Must not translate an entire scientific document');
      },
    },
  });
  await collector.processOne();
  const result = store.get(a.id);
  assert.equal(result.status, 'ready');
  assert.equal(summaries, 1);
  assert.deepEqual(fetched, [a.url]);
  assert.deepEqual(result.content, []);
  assert.deepEqual(result.translatedContent, []);
  assert.equal(result.summaryScope, 'paper_abstract');
  assert.equal(result.readingMode, 'scientific_links');
  assert.match(result.abstract, /Los autores/);
});

test('A scientific landing page without a published abstract never summarizes unrelated body or headline', async () => {
  const extractor = new ArticleExtractor({
    robots: { allowed: async () => {} },
    get: async (url) => ({ url, type: 'text/html', body: record('') }),
  });
  const result = await extractor.extract('https://journal.example/paper');
  assert.equal(result.text, '');
  assert.deepEqual(result.blocks, []);
  assert.ok(result.paper.pdfUrl);
});

test('Older papers hide reconstructed bodies in the API; news with references retains clean reading', () => {
  const old = {
    paper: { pdfUrl: 'https://journal.example/paper.pdf' },
    abstract: 'Resumen existente en español',
    content: [{ type: 'paragraph', text: 'broken formula' }],
    translatedContent: [{ type: 'paragraph', text: 'old translation' }],
  };
  const view = readerArticle(old);
  assert.deepEqual(view.content, []);
  assert.deepEqual(view.translatedContent, []);
  assert.equal(view.abstract, old.abstract);
  assert.equal(old.content.length, 1);
  const news = {
    papers: [{ relation: 'reference', pdfUrl: 'https://journal.example/paper.pdf' }],
    content: old.content,
  };
  assert.equal(readerArticle(news), news);
});

test('Scientific summary instruction requests a Spanish explanation and records the correct scope', async () => {
  const model = new OllamaModel();
  const instructions = [];
  model.json = async (instruction, input, properties) => {
    instructions.push(instruction);
    return properties.notes
      ? { notes: 'Los autores presentan un método de optimización.' }
      : {
          titleEs: 'Investigación del compilador',
          abstract: 'Los autores explican su método.',
          keyPoints: [],
        };
  };
  const result = await model.summarize('Compiler research', authorAbstract, { scientific: true });
  assert.equal(result.summaryBasis, 'paper_abstract');
  assert.match(instructions.at(-1), /en español/);
  assert.match(instructions.at(-1), /no del paper completo/);
});
