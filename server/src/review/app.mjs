import Fastify from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const assets = fileURLToPath(new URL('./public/', import.meta.url));
const labels = {
  verdict: ['correct', 'incorrect', 'unrated'],
  expected: ['accept', 'reject', 'review', 'unspecified'],
  duplicate: ['same', 'different', 'unspecified'],
  summary: ['faithful', 'errors', 'unspecified'],
};

export function createReviewApp({ dataDir, port = 8791 }) {
  mkdirSync(dataDir, { recursive: true });
  const snapshot = JSON.parse(readFileSync(join(dataDir, 'snapshot.json'), 'utf8'));
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.articles))
    throw new Error('Snapshot incompatible');
  const articles = new Map(snapshot.articles.map((a) => [a.id, a]));
  const db = new DatabaseSync(join(dataDir, 'feedback.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS feedback (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, article_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL)`);
  const app = Fastify({ bodyLimit: 16000 });
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      )
      .header('Referrer-Policy', 'no-referrer');
    if (!hosts.has(req.headers.host)) return reply.code(403).send({ error: 'Host no permitido' });
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return reply.code(403).send({ error: 'Origen no permitido' });
    if (req.headers.origin && ![...hosts].some((host) => req.headers.origin === `http://${host}`))
      return reply.code(403).send({ error: 'Origen no permitido' });
    if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json'))
      return reply.code(415).send({ error: 'Se requiere JSON' });
  });
  app.addHook('onClose', async () => db.close());
  const history = () =>
    db
      .prepare('SELECT data FROM feedback ORDER BY sequence')
      .all()
      .map((r) => JSON.parse(r.data));
  app.get('/api/review', async () => {
    const latest = new Map(history().map((f) => [f.articleId, f]));
    return {
      ...snapshot,
      articles: snapshot.articles.map((a) => ({ ...a, feedback: latest.get(a.id) ?? null })),
    };
  });
  app.get('/api/feedback/export', async (_, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="andes-feedback.json"');
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      snapshotAt: snapshot.capturedAt,
      feedback: history(),
    };
  });
  app.post('/api/feedback', async (req, reply) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b))
      return reply.code(400).send({ error: 'Feedback inválido' });
    const a = articles.get(b.articleId);
    if (!a) return reply.code(404).send({ error: 'Noticia no encontrada' });
    if (b.fingerprint !== a.fingerprint)
      return reply.code(409).send({ error: 'La evaluación cambió. Recarga y vuelve a revisar.' });
    for (const [key, values] of Object.entries(labels)) {
      if (!values.includes(b[key]))
        return reply.code(400).send({ error: `Valor inválido: ${key}` });
    }
    if (typeof b.note !== 'string' || b.note.length > 4000)
      return reply.code(400).send({ error: 'Comentario demasiado largo o inválido' });
    const comparisonId = b.comparisonId;
    const comparison = comparisonId ? articles.get(comparisonId) : null;
    if (b.comparisonId && (!comparison || comparison.id === a.id))
      return reply.code(400).send({ error: 'Elige otra noticia válida para comparar' });
    if (b.comparisonId && b.comparisonFingerprint !== comparison.fingerprint)
      return reply.code(409).send({ error: 'La noticia comparada cambió. Recarga la captura.' });
    if (b.duplicate !== 'unspecified' && !comparison)
      return reply.code(400).send({ error: 'No hay un par de noticias para comparar' });
    const f = {
      id: randomUUID(),
      articleId: a.id,
      fingerprint: a.fingerprint,
      createdAt: new Date().toISOString(),
      snapshotAt: snapshot.capturedAt,
      article: { title: a.title, url: a.url, source: a.source },
      comparison: comparison
        ? {
            id: comparison.id,
            fingerprint: comparison.fingerprint,
            title: comparison.title,
            url: comparison.url,
          }
        : null,
      observed: {
        category: a.category,
        state: a.state,
        editorialStatus: a.editorialStatus,
        decision: a.decision,
        duplicateOf: a.duplicateOf,
        duplicateCandidateOf: a.duplicateCandidateOf,
      },
      ...Object.fromEntries(Object.keys(labels).map((key) => [key, b[key]])),
      note: b.note.trim(),
    };
    db.prepare(
      'INSERT INTO feedback (id,article_id,fingerprint,created_at,data) VALUES (?,?,?,?,?)',
    ).run(f.id, a.id, a.fingerprint, f.createdAt, JSON.stringify(f));
    return { feedback: f };
  });
  for (const [url, file, type] of [
    ['/', 'index.html', 'text/html'],
    ['/app.js', 'app.js', 'text/javascript'],
    ['/style.css', 'style.css', 'text/css'],
  ]) {
    app.get(url, async (_, reply) => reply.type(type).send(readFileSync(join(assets, file))));
  }
  return app;
}
