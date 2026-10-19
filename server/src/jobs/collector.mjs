import { sources, loadSource } from '../services/sources.mjs';
import { ArticleExtractor } from '../services/article_extractor.mjs';
import { OllamaModel, detectLanguage } from '../services/ollama.mjs';
import { assessFocus } from '../services/focus.mjs';
import { EditorialPolicy } from '../services/editorial.mjs';
import { PublicationPolicy, checkSummary } from '../services/publication.mjs';
import { isScientificDocument } from '../services/reading_policy.mjs';
export const POLL_INTERVAL = 2 * 60 * 60 * 1000;
export class Collector {
  constructor({
    store,
    extractor = new ArticleExtractor(),
    model = new OllamaModel({ store }),
    load = loadSource,
    now = () => Date.now(),
    interval = POLL_INTERVAL,
    editorial,
    publication,
    managedSources = (process.env.HORIZON_MANAGED_SOURCES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  } = {}) {
    this.store = store;
    this.extractor = extractor;
    this.model = model;
    this.load = load;
    this.now = now;
    this.interval = interval;
    this.editorial = editorial ?? new EditorialPolicy({ store });
    this.publication = publication ?? new PublicationPolicy({ store, now });
    if (managedSources.some((id) => !sources.some((s) => s.id === id)))
      throw Error('Invalid HORIZON_MANAGED_SOURCES');
    this.managedSources = new Set(managedSources);
    if (this.editorial.mode === 'shadow') this.store.hideShadowNegatives();
    this.discovering = false;
    this.processing = false;
    this.stopped = false;
  }
  async discover() {
    if (this.discovering) return;
    this.discovering = true;
    const started = this.now();
    this.store.setMeta('nextCollectionAt', started + this.interval);
    const errors = {};
    let added = 0,
      filtered = 0;
    try {
      for (const source of sources) {
        if (this.managedSources.has(source.id)) continue;
        try {
          const candidates = await this.load(source);
          let selected = 0;
          for (const candidate of candidates) {
            try {
              const relevance = assessFocus(candidate);
              if (!relevance.accepted && this.editorial.mode === 'rules') {
                filtered++;
                continue;
              }
              if (selected++ >= 20) break;
              if (
                this.store.discover({
                  ...candidate,
                  ingestionShadow: this.editorial.mode === 'shadow' && !relevance.accepted,
                  relevance:
                    this.editorial.mode === 'rules' ? relevance : { ...relevance, accepted: true },
                  topic: relevance.topic,
                }).isNew
              )
                added++;
            } catch (_) {
              errors[source.id] = 'invalid_source_item';
            }
          }
        } catch (e) {
          errors[source.id] = e.code ?? 'source_unavailable';
        }
      }
      this.store.setMeta('collection', {
        startedAt: new Date(started).toISOString(),
        completedAt: new Date(this.now()).toISOString(),
        added,
        filtered,
        errors,
      });
      this.store.prune();
    } finally {
      this.discovering = false;
    }
  }
  async processOne() {
    if (this.processing) return false;
    let article = this.store.next();
    if (!article) return false;
    this.processing = true;
    this.store.save(article, 'processing');
    try {
      if (
        !article.contentText ||
        article.needsRichExtraction ||
        (isScientificDocument(article) &&
          !article.abstract &&
          article.summaryScope !== 'paper_abstract')
      ) {
        const native =
          article.contentKind && article.contentKind !== 'article' && article.nativeText?.trim();
        const body = native
          ? {
              blocks: [{ type: 'paragraph', text: article.nativeText }],
              papers:
                (await this.extractor.nativeReferences?.(article.nativeText, article.url)) ?? [],
              text: article.nativeText,
              coverage: 'native',
              extractionVersion: 2,
              language: article.languageHint,
              wordCount: article.nativeText.split(/\s+/).length,
              author: article.author,
              fetchedAt: new Date(this.now()).toISOString(),
              extractionMethod: 'horizon-native',
              resolvedUrl: article.url,
            }
          : await this.extractor.extract(article.url, article);
        article = {
          ...article,
          content: body.blocks,
          contentText: body.text,
          translatedContent: [],
          needsRichExtraction: false,
          extractionVersion: body.extractionVersion,
          coverage: body.coverage,
          language: detectLanguage(
            body.blocks
              .filter((b) => b.type !== 'code')
              .map((b) => b.text)
              .join('\n')
              .slice(0, 12000),
            body.language,
          ),
          author: body.author,
          wordCount: body.wordCount,
          fetchedAt: body.fetchedAt,
          extractionMethod: body.extractionMethod,
          resolvedUrl: body.resolvedUrl,
          paper: body.paper,
          papers: body.papers,
          paperDiscoveryFailures: body.paperDiscoveryFailures,
          contentScope: body.contentScope,
          readingMode: body.readingMode,
          summaryScope: body.summaryScope,
          paperHtmlError: body.paperHtmlError,
          imageUrl: body.imageUrl || article.imageUrl,
        };
        this.store.save(article, 'processing');
        if (!article.contentText?.trim()) {
          // Keep the original document link; never summarize an unread PDF.
          this.store.save({ ...article, lastError: 'document_text_unavailable' }, 'unavailable');
          return true;
        }
      }
      article = await this.editorial.evaluate(article);
      if (
        !article.relevance.accepted ||
        (article.ingestionShadow &&
          this.editorial.mode === 'shadow' &&
          article.editorialStatus !== 'accepted')
      ) {
        // Retain the decision/body for review without spending summary and
        // translation inference on hidden rejected, uncertain or failed items.
        this.store.save(article, 'filtered');
        return true;
      }
      const exact = this.store.findContentDuplicate(article);
      if (exact) {
        article.dedupMethod = 'content_hash';
        article.duplicateOf = exact.id;
        article.editorialStatus = 'duplicate';
        this.store.save(article, 'filtered');
        return true;
      }
      if (this.editorial.mode !== 'rules' && article.editorialStatus === 'accepted') {
        const duplicate = await this.editorial.duplicate(article).catch((error) => {
          if (this.editorial.mode !== 'shadow') throw error;
          article.dedupError = 'semantic_dedup_unavailable';
          return null;
        });
        if (duplicate) {
          article.dedupMethod = duplicate.method;
          if (
            this.editorial.mode === 'laya' &&
            (duplicate.method === 'content_hash' || this.editorial.dedup === 'active')
          ) {
            article.duplicateOf = duplicate.id;
            article.editorialStatus = 'duplicate';
            this.store.save(article, 'filtered');
            return true;
          }
          article.duplicateCandidateOf = duplicate.id;
        }
      }
      if (!article.abstract) {
        article = {
          ...article,
          ...(await this.model.summarize(article.title, article.contentText, {
            scientific: isScientificDocument(article),
          })),
        };
        this.store.save(article, 'processing');
      }
      if (isScientificDocument(article)) {
        article.readingMode = 'scientific_links';
        article.content = [];
        article.translatedContent = [];
      } else if (article.language !== 'es' && !article.translatedContent?.length) {
        article.translatedContent = await this.model.translate(article.content);
        this.store.save(article, 'processing');
      }
      article.processedAt = new Date(this.now()).toISOString();
      article.lastError = null;
      article.status = 'ready';
      article.summaryQuality = checkSummary(article);
      this.store.save(article, 'ready');
      this.publication.publish(article);
    } catch (e) {
      this.store.fail(article, e.code ?? e.message ?? 'processing_failed');
      console.warn(`Article ${article.id}: ${e.code ?? e.message ?? 'failed'}`);
    } finally {
      this.processing = false;
    }
    return true;
  }
  async tick() {
    const next = this.store.getMeta('nextCollectionAt') ?? 0;
    if (this.now() >= next && !this.discovering) await this.discover();
  }
  start() {
    // Collection and inference have separate loops: news discovery continues
    // every two hours even when the GPU is still processing the previous queue.
    this.stopped = false;
    this.collectionTimer = setInterval(
      () => this.tick().catch((e) => console.warn('Collection failed:', e.message)),
      15000,
    );
    this.tick().catch((e) => console.warn('Initial collection failed:', e.message));
    const work = async () => {
      if (this.stopped) return;
      try {
        await this.processOne();
      } catch (e) {
        console.warn('Worker failed:', e.message);
      }
      if (!this.stopped) this.workerTimer = setTimeout(work, 1000);
    };
    work();
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.collectionTimer);
    clearTimeout(this.workerTimer);
    while (this.processing || this.discovering)
      await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
