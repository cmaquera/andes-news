import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFocus } from '../src/services/focus.mjs';
import { Store } from '../src/repositories/sqlite_store.mjs';
import { Collector } from '../src/jobs/collector.mjs';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, sep } from 'node:path';

test('Accepts engineering, AI methods/applications and developer-relevant hardware', () => {
  for (const title of [
    'Python añade nuevas herramientas de debugging',
    'Cómo aplicar RAG y agentes de IA en una API',
    'Una universidad peruana aplica IA para detectar enfermedades',
    'Colombia implementa modelos de IA para detectar fraude',
    'Fine-tuning open models with LoRA',
    'El nuevo celular incorpora un SDK de inferencia local para desarrolladores',
    'TypeScript mejora su compilador',
    'Copilot cambia el proceso de code review',
    'Impacto de la IA en los programadores en Latinoamérica',
  ])
    assert.equal(assessFocus({ title }).accepted, true, title);
  assert.equal(
    assessFocus({ title: 'New repository branch controls', sourceId: 'github' }).accepted,
    true,
  );
  assert.ok(
    assessFocus({ title: 'Perú implementa modelos de IA para agricultura' }).priority >
      assessFocus({ title: 'New language models improve reasoning' }).priority,
  );
});
test('Rejects consumer launches, AI marketing and generic technology/employment', () => {
  for (const title of [
    'El nuevo iPhone tiene una cámara mejorada',
    'Samsung lanza un celular con IA que mejora las fotos',
    'Las mejores ofertas de Xiaomi para comprar hoy',
    'ChatGPT revela tu horóscopo',
    'La IA está de moda entre ejecutivos',
    'La nueva televisión trae inteligencia artificial',
    'Un jefe boomer no entiende a los millennials',
    'El trabajo híbrido y el regreso a la oficina',
    'Netflix estrena una nueva serie',
    'Nueva vulnerabilidad en el router doméstico',
  ])
    assert.equal(assessFocus({ title }).accepted, false, title);
  assert.equal(
    assessFocus(
      {
        title: 'El nuevo celular Samsung con IA',
        contentText: 'Su cámara cuenta con software. Un SDK existe para sus apps.',
      },
      { full: true },
    ).accepted,
    false,
  );
});
test('Filters before GPU work; detail keeps stored rejected stories but feed excludes them', async () => {
  const store = new Store(':memory:');
  let extractions = 0;
  const collector = new Collector({
    store,
    load: async () => [
      { title: 'Nueva API de Python', url: 'https://example.com/dev', sourceId: 'gestion' },
      {
        title: 'El nuevo celular Samsung con IA',
        url: 'https://example.com/phone',
        sourceId: 'gestion',
      },
    ],
    extractor: {
      extract: async () => {
        extractions++;
        return {
          blocks: [{ type: 'paragraph', text: 'Python API details' }],
          text: 'Python API details',
          language: 'es',
          coverage: 'extracted',
          extractionVersion: 2,
        };
      },
    },
    model: {
      summarize: async () => ({
        abstract: 'API preparada',
        titleEs: 'Nueva API de Python',
        keyPoints: [],
      }),
    },
  });
  await collector.discover();
  assert.equal(store.list().length, 1);
  assert.equal(store.getMeta('collection').filtered, 6);
  await collector.processOne();
  assert.equal(extractions, 1);
  const hidden = store.discover({
    title: 'Nuevo iPhone a buen precio',
    url: 'https://example.com/old',
  }).article;
  assert.equal(store.get(hidden.id).status, 'filtered');
  assert.equal(store.list().length, 1);
  assert.equal(store.next(), null);
  store.close();
});
test('Upgrade reassesses old feed and pending jobs without deleting saved detail', () => {
  const root = join(process.cwd(), 'build');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'focus-upgrade-'));
  assert.ok(dir.startsWith(root + sep));
  let store;
  try {
    const path = join(dir, 'test.db');
    store = new Store(path);
    const a = store.discover({ title: 'Python API release', url: 'https://example.com/a' }).article;
    store.save(
      {
        ...a,
        title: 'Nuevo celular con IA para fotos',
        relevance: undefined,
        abstract: 'Resumen antiguo',
        contentText: 'Texto guardado',
        extractionVersion: 2,
      },
      'ready',
    );
    store.setMeta('focusVersion', 0);
    store.close();
    store = undefined;
    store = new Store(path);
    assert.equal(store.list().length, 0);
    assert.equal(store.get(a.id).abstract, 'Resumen antiguo');
    assert.equal(store.get(a.id).status, 'filtered');
    assert.equal(store.next(), null);
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
