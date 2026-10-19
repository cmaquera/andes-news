import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { sourceIdentity } from '../services/source_identity.mjs';

export function fingerprint(article) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        article.id,
        article.state,
        article.decision,
        article.editorialStatus,
        article.duplicateOf,
        article.duplicateCandidateOf,
        article.abstract,
        article.relevance,
        article.ingestionShadow,
        article.publishedToFeedAt,
        article.editorialReviewed,
        article.title,
        article.url,
        article.excerpt,
        article.keyPoints,
        article.selectionReasons,
        article.summaryScope,
        article.summaryBasis,
      ]),
    )
    .digest('hex');
}

export function category(a) {
  if (a.duplicateOf) return 'duplicate';
  if (a.duplicateCandidateOf) return 'candidate';
  if (a.editorialStatus === 'review' || a.editorialStatus === 'error') return 'review';
  if (a.editorialStatus === 'rejected' || a.relevance?.accepted === false) return 'rejected';
  if (a.ingestionShadow) return 'shadow';
  if (a.state === 'filtered') return 'filtered';
  if (a.state === 'ready') return 'ready';
  return 'pending';
}

export function exportSnapshot(path, capturedAt = new Date().toISOString()) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    const decisions = new Map(
      db
        .prepare('SELECT article_id, data FROM editorial_decisions')
        .all()
        .map((r) => [r.article_id, JSON.parse(r.data)]),
    );
    const occurrences = new Map();
    for (const row of db.prepare('SELECT article_id, data FROM source_occurrences').all()) {
      const list = occurrences.get(row.article_id) ?? [];
      const raw = JSON.parse(row.data);
      list.push({
        source: sourceIdentity(raw).name,
        url: raw.url ?? raw.sourceUrl,
        externalId: raw.externalId,
        sourceType: raw.sourceType,
      });
      occurrences.set(row.article_id, list);
    }
    const articles = db
      .prepare('SELECT id, data, state, updated FROM articles ORDER BY discovered DESC')
      .all()
      .map((row) => {
        const raw = JSON.parse(row.data);
        const source = sourceIdentity(raw);
        const a = {
          id: row.id,
          title: raw.title,
          titleEs: raw.titleEs,
          url: raw.url,
          source: source.name,
          sourceType: source.kind,
          published: raw.published,
          updated: row.updated,
          state: row.state,
          editorialStatus: raw.editorialStatus,
          editorialScore: raw.editorialScore,
          relevance: raw.relevance,
          selectionReasons: raw.selectionReasons,
          ingestionShadow: raw.ingestionShadow,
          publishedToFeedAt: raw.publishedToFeedAt,
          editorialReviewed: raw.editorialReviewed,
          duplicateOf: raw.duplicateOf,
          duplicateCandidateOf: raw.duplicateCandidateOf,
          dedupMethod: raw.dedupMethod,
          abstract: raw.abstract,
          keyPoints: raw.keyPoints,
          summaryScope: raw.summaryScope,
          summaryBasis: raw.summaryBasis,
          decision: decisions.get(row.id) ?? null,
          occurrences: occurrences.get(row.id) ?? [],
        };
        const body = String(raw.contentText ?? raw.nativeText ?? raw.feedExcerpt ?? '');
        a.excerpt = body.slice(0, 16000);
        a.bodyTruncated = body.length > 16000;
        a.category = category(a);
        a.fingerprint = fingerprint(a);
        return a;
      });
    return { schemaVersion: 1, capturedAt, total: articles.length, articles };
  } finally {
    db.close();
  }
}
