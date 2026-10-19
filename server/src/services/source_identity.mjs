import { createHash } from 'node:crypto';
import { sources } from '../config/sources.mjs';

const labels = {
  hackernews: 'Hacker News',
  reddit: 'Reddit',
  telegram: 'Telegram',
  twitter: 'X',
  github: 'GitHub',
  openbb: 'OpenBB',
  ossinsight: 'OSS Insight',
  gdelt: 'GDELT',
  google_news: 'Google News',
  rss: 'RSS',
};
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);

// A connector instance is provenance, not a second publisher in Settings.
export function sourceIdentity(item) {
  const type = item.sourceType ?? item.kind;
  const sourceId = item.sourceId ?? item.id;
  if (type === 'hackernews') return sources.find((s) => s.id === 'hn');
  if (type === 'rss') {
    const builtin = sources.find(
      (s) =>
        s.kind === 'rss' &&
        (item.sourceFeedUrl === s.url || item.sourceName === `rss:${s.name}:${hash(s.url)}`),
    );
    if (builtin) return builtin;
  }
  const builtin = sources.find((s) => s.id === sourceId);
  if (builtin) return builtin;
  const raw = item.sourceName ?? item.name ?? '';
  const name = type === 'rss' ? raw.replace(/^rss:/, '').replace(/:[a-f0-9]{12}$/, '') : raw;
  return {
    id:
      sourceId ??
      `horizon:${type ?? 'unknown'}:${hash(item.sourceInstanceId ?? type ?? 'unknown')}`,
    name: !name || name === type ? (labels[type] ?? type ?? 'Fuente') : name,
    region: item.region ?? 'Global',
    kind: type,
  };
}

export function sourceCatalog(items, includeBuiltin = true) {
  const catalog = new Map(
    (includeBuiltin ? sources : []).map((s) => [s.id, { ...s, aliases: [] }]),
  );
  for (const item of items) {
    const source = sourceIdentity(item);
    const row = catalog.get(source.id) ?? { ...source, aliases: [] };
    if (item.sourceId && item.sourceId !== source.id && !row.aliases.includes(item.sourceId))
      row.aliases.push(item.sourceId);
    for (const alias of item.aliases ?? [])
      if (!row.aliases.includes(alias)) row.aliases.push(alias);
    catalog.set(source.id, row);
  }
  return [...catalog.values()];
}
