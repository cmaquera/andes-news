import { resolve } from 'node:path';
import { createReviewApp } from './app.mjs';

const dataDir = resolve(process.argv[2] ?? '../build/review');
const port = Number(process.argv[3] ?? 8791);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Puerto inválido');
const app = createReviewApp({ dataDir, port });
await app.listen({ host: '127.0.0.1', port });
console.log(`Revisión Andes: http://127.0.0.1:${port} · datos: ${dataDir}`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
