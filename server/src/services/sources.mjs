import Parser from 'rss-parser';
import { publicGet } from './public_http.mjs';
import { assessFocus } from './focus.mjs';
export { sources } from '../config/sources.mjs';
export function topicOf(text) {
  const t = text.toLowerCase();
  if (/\b(ai|ia|llm|gpt|claude|gemini|machine learning|inteligencia artificial)\b/.test(t))
    return 'IA';
  if (/seguridad|security|vulnerab|ciber|cyber|malware/.test(t)) return 'Seguridad';
  if (/github|open.source|código abierto/.test(t)) return 'Open source';
  if (
    /\b(programación|programming|developer|desarrollo|python|javascript|typescript|rust|linux|software|api|docker|kubernetes|coding|database|sql|react|flutter|backend|frontend|compiler)\b/.test(
      t,
    )
  )
    return 'Programación';
  return 'Tecnología';
}
function plain(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function date(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
export async function loadSource(source, { get = publicGet, limit = 20 } = {}) {
  const response = await get(source.url);
  let items;
  if (source.kind === 'rss') {
    const parser = new Parser();
    items = (await parser.parseString(response.body)).items
      .slice(0, Math.min(100, limit * 4))
      .map((j) => ({
        title: plain(j.title),
        url: j.link,
        feedExcerpt: plain(j.contentSnippet ?? j.content ?? j.summary),
        imageUrl: j.enclosure?.type?.startsWith('image/') ? j.enclosure.url : '',
        published: date(j.isoDate ?? j.pubDate),
      }));
  } else if (source.kind === 'dev') {
    items = JSON.parse(response.body)
      .slice(0, limit)
      .map((j) => ({
        title: j.title,
        url: j.url,
        apiArticleId: j.id,
        feedExcerpt: j.description ?? '',
        imageUrl: j.cover_image ?? '',
        published: date(j.published_at),
        score: j.positive_reactions_count ?? 0,
        comments: j.comments_count ?? 0,
      }));
  } else {
    items = [];
    for (const id of JSON.parse(response.body).slice(0, 40)) {
      try {
        const j = JSON.parse(
          (await get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).body,
        );
        if (
          j &&
          !j.dead &&
          !j.deleted &&
          j.type === 'story' &&
          j.url &&
          assessFocus({ title: j.title, sourceId: 'hn' }).accepted
        )
          items.push({
            title: plain(j.title),
            url: j.url,
            feedExcerpt: '',
            imageUrl: '',
            published: date(j.time * 1000),
            score: j.score ?? 0,
            comments: j.descendants ?? 0,
          });
      } catch (_) {}
      if (items.length >= limit) break;
    }
  }
  return items
    .filter((j) => j.title && /^https?:\/\//.test(j.url))
    .map((j) => ({
      ...j,
      sourceId: source.id,
      sourceName: source.name,
      region: source.region,
      topic: topicOf(j.title + ' ' + j.feedExcerpt),
    }));
}
