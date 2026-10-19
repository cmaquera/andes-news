import { writeFileSync } from 'node:fs';
import { exportSnapshot } from '../src/review/snapshot.mjs';

const [database, output] = process.argv.slice(2);
if (!database) throw new Error('Uso: node scripts/export_review_snapshot.mjs DB [salida.json]');
const json = JSON.stringify(exportSnapshot(database));
if (output) writeFileSync(output, json, { mode: 0o600 });
else process.stdout.write(json);
