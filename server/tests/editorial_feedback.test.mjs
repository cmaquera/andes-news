import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/repositories/sqlite_store.mjs';
import { EditorialPolicy, EDITORIAL_VERSION } from '../experiments/editorial_v4.mjs';
import { assessFocus } from '../src/services/focus.mjs';

test('Engineering experience can be valuable without code or benchmarks; uncertainty abstains', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const evaluate = async (id, useful) => {
    const policy = new EditorialPolicy({
      store,
      mode: 'laya',
      client: {
        revision: id,
        predict: async () => ({
          probabilities: { relevant: 0.96, useful, technical: 0.05, evidence: 0.1 },
          routing: { model: 'fixture' },
        }),
      },
    });
    return policy.evaluate({
      id,
      title: 'What we learned maintaining a small software product',
      contentText:
        'A first-hand account of product maintenance, tradeoffs in development workflows and lessons learned from user feedback. '.repeat(
          4,
        ),
    });
  };
  const accepted = await evaluate('grounded-experience', 0.96);
  assert.equal(accepted.editorialStatus, 'accepted');
  assert.ok(accepted.editorialScore >= 8.5);
  assert.equal(accepted.evaluationVersion, EDITORIAL_VERSION);
  assert.equal((await evaluate('ambiguous-value', 0.5)).editorialStatus, 'review');
  assert.equal((await evaluate('no-value', 0.05)).editorialStatus, 'rejected');
});

test('Decorative headers do not consume the main-subject lead; body is still fully evaluated', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const calls = [];
  const policy = new EditorialPolicy({
    store,
    mode: 'laya',
    client: {
      revision: 'ascii-header',
      predict: async (input) => {
        calls.push(input);
        return {
          probabilities: { relevant: 0.95, useful: 0.95, technical: 0.95, evidence: 0.95 },
          routing: {},
        };
      },
    },
  });
  await policy.evaluate({
    id: 'network-tool',
    title: 'An interoperable networking tool',
    contentText:
      '   :=++@@++=:\n'.repeat(150) +
      'Networking software implementing standard encrypted routing protocols. '.repeat(20),
  });
  assert.match(calls[0].lead, /Networking software/);
  assert.ok(Buffer.byteLength(calls[0].lead) <= 1200);
  assert.ok(calls.slice(1).some((c) => c.text.includes(':=++@@++=:')));
  assert.equal(store.decisions()[0].truncated, false);
});

test('Scope covers parsers, infrastructure, practical AI and web performance without treating jobs as shopping', () => {
  for (const a of [
    { title: 'Parsing expressions with combinators' },
    { title: 'IPsec routing interoperability' },
    { title: 'A modal text editor with LSP support' },
    {
      title: 'Lecciones al crear un agregador de ofertas de empleo',
      feedExcerpt: 'Las ofertas están dispersas.',
      contentText: 'Construido con Astro y un scraper de código abierto.',
    },
    {
      title: 'Cómo mejorar la carga de una web en celulares',
      contentText: 'Core Web Vitals, srcset and lazy loading.',
    },
    { title: 'Cómo pedirle a una IA que resuma un informe' },
    {
      title: 'Una startup aplica IA a la búsqueda de empleo',
      feedExcerpt: 'Una plataforma analiza ofertas para sus usuarios.',
    },
    { title: 'Software API pricing and integration costs' },
    {
      title: 'Someone building software',
      feedExcerpt:
        'An engineering account. ' + '.'.repeat(600) + ' Comprar Samsung al mejor precio.',
    },
  ])
    assert.equal(assessFocus(a, { full: true }).accepted, true, a.title);
  for (const a of [
    {
      title: 'Ofertas del nuevo iPhone',
      contentText: 'Una API y un SDK existen para programadores.',
    },
    { title: 'Una nueva aspiradora para el hogar' },
    { title: 'Las mejores ofertas de trabajo para vendedores' },
    { title: 'ChatGPT revela tu horóscopo' },
    {
      title: 'Un celular con IA para fotos',
      abstract: 'Un resumen con prompts, software y ejemplos de programación.',
    },
  ])
    assert.equal(assessFocus(a, { full: true }).accepted, false, a.title);
});
