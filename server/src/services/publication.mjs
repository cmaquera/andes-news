import { assessFocus } from './focus.mjs';
import { EDITORIAL_VERSION } from './editorial.mjs';

export const SUMMARY_CHECK_VERSION = 'summary-check-v1';
const publicationDay = (at) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
const normalize = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .toLowerCase();
const numbers = (text) =>
  new Set(
    (normalize(text).match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) =>
      n.replace(/[.,]/g, '').replace(/^0+(?=\d)/, ''),
    ),
  );
const reliability =
  /(?:no (?:se (?:pueden? )?(?:verificar|validar|extraer)|proporciona|contiene|ofrece|presenta).{0,65}(?:confiabl|verificabl|fiabil|hechos|datos)|informaci[oó]n recibida es insuficiente para atribuir)/i;

// Conservative checks for known failure modes, not a factual-accuracy judge.
export function checkSummary(article) {
  const source = `${article.title}\n${article.contentText ?? ''}`;
  const output = `${article.titleEs ?? ''}\n${article.abstract ?? ''}\n${(article.keyPoints ?? []).join('\n')}`;
  const reasons = [];
  if (!article.abstract?.trim() || !article.contentText?.trim())
    reasons.push('missing_summary_or_body');
  if (Buffer.byteLength(output) > 7000) reasons.push('summary_too_long');
  if (reliability.test(output) && !reliability.test(source))
    reasons.push('unsupported_reliability_claim');
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(output))
    reasons.push('unexpected_script_in_spanish_summary');
  const available = numbers(source),
    unsupported = [...numbers(output)].filter((n) => !available.has(n));
  if (unsupported.length) reasons.push('numbers_not_found_in_source');
  return {
    version: SUMMARY_CHECK_VERSION,
    status: reasons.length ? 'review' : 'passed',
    reasons,
    unsupportedNumbers: unsupported.slice(0, 20),
  };
}

export function publicationSettings(env = process.env) {
  const mode = env.PUBLICATION_MODE ?? 'reviewed';
  const dailyLimit = Number(env.PILOT_DAILY_LIMIT ?? 3);
  const minScore = Number(env.PILOT_MIN_SCORE ?? 8.5);
  const sourceTypes = (env.PILOT_SOURCE_TYPES ?? 'hackernews')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!['reviewed', 'canary'].includes(mode)) throw Error('Invalid PUBLICATION_MODE');
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 20)
    throw Error('Invalid PILOT_DAILY_LIMIT');
  if (!Number.isFinite(minScore) || minScore < 7 || minScore > 10)
    throw Error('Invalid PILOT_MIN_SCORE');
  if (!sourceTypes.length || sourceTypes.some((s) => !/^[a-z_]+$/.test(s)))
    throw Error('Invalid PILOT_SOURCE_TYPES');
  return { mode, dailyLimit, minScore, sourceTypes };
}

export class PublicationPolicy {
  constructor({ store, now = () => Date.now(), ...settings } = {}) {
    this.store = store;
    this.now = now;
    Object.assign(this, publicationSettings(), settings);
  }
  publish(article) {
    if (this.mode !== 'canary' || !article.ingestionShadow || article.status !== 'ready')
      return false;
    const eligible =
      article.sourceId?.startsWith('horizon:') &&
      this.sourceTypes.includes(article.sourceType) &&
      article.evaluationVersion === EDITORIAL_VERSION &&
      article.editorialStatus === 'accepted' &&
      article.editorialScore >= this.minScore &&
      !article.editorialReviewed &&
      !article.duplicateOf &&
      !article.duplicateCandidateOf &&
      assessFocus({ ...article, abstract: '' }, { full: true }).accepted &&
      article.summaryQuality?.version === SUMMARY_CHECK_VERSION &&
      article.summaryQuality?.status === 'passed';
    if (!eligible) return false;
    const at = this.now();
    const day = publicationDay(at);
    return this.store.publishPilot(article.id, { day, at, limit: this.dailyLimit });
  }
  status() {
    return {
      mode: this.mode,
      dailyLimit: this.dailyLimit,
      minScore: this.minScore,
      sourceTypes: this.sourceTypes,
      day: publicationDay(this.now()),
      ...this.store.pilotStatus(publicationDay(this.now())),
    };
  }
}
