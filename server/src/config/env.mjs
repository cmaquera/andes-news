import { isIP } from 'node:net';
export const APP_VERSION = '0.5.0';
export function serverSettings(env = process.env) {
  return {
    apiToken: env.ANDES_API_TOKEN,
    port: parsePort(env.PORT ?? 8787, 'PORT'),
    host: env.HOST ?? '127.0.0.1',
    databasePath: env.DATABASE_PATH ?? '/data/andes.db',
    ingestionToken: env.ANDES_INGESTION_TOKEN,
    ingestionHost: env.INGESTION_HOST ?? '127.0.0.1',
    ingestionPort: parsePort(env.INGESTION_PORT ?? 8788, 'INGESTION_PORT'),
    ingestionMode: env.INGESTION_MODE ?? 'shadow',
  };
}
export const DEFAULT_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';
export function parsePort(value, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535)
    throw Error(`${name} must be a port between 1 and 65535`);
  return Number(value);
}
export function ollamaEndpoint({
  host = process.env.OLLAMA_SERVICE_HOST ?? '127.0.0.1',
  port = process.env.OLLAMA_SERVICE_PORT ?? '11434',
} = {}) {
  if (typeof host !== 'string' || (!isIP(host) && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(host)))
    throw Error('OLLAMA_SERVICE_HOST must be a hostname or IP, without a URL scheme');
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${parsePort(port, 'OLLAMA_SERVICE_PORT')}`;
}
