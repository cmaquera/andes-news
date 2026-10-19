import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { SourceError, publicGet, RobotsPolicy } from './public_http.mjs';
import { publicUrl } from './public_http.mjs';
import { randomUUID } from 'node:crypto';
import { arxivIdentity } from './arxiv.mjs';
import { resolveScientificReferences, nativeReferencePage } from './scientific_documents.mjs';

const unwanted =
  'script,style,iframe,form,button,input,nav,footer,aside,noscript,svg,[role="dialog"],[aria-modal="true"],.advertisement,.ad-container,.adsbygoogle,.newsletter-signup,.related-articles,.related-posts,.article-related,[id*="cookie"],[class*="cookie"],[id*="consent"],[class*="consent"]';
const clean = (text) => text.replace(/\s+/g, ' ').trim();
function mediaUrl(value, base) {
  if (!value) return '';
  try {
    const u = publicUrl(new URL(value, base).href);
    return u.protocol === 'https:' ? u.href : '';
  } catch (_) {
    return '';
  }
}
function imageSource(node, base) {
  const sets =
    node.getAttribute('data-srcset') ||
    node.getAttribute('srcset') ||
    node.closest('picture')?.querySelector('source')?.getAttribute('srcset') ||
    '';
  const largest = sets
    .split(',')
    .map((s) => s.trim().split(/\s+/))
    .sort((a, b) => parseFloat(b[1] || '0') - parseFloat(a[1] || '0'))[0]?.[0];
  for (const value of [
    node.getAttribute('data-src'),
    node.getAttribute('data-original'),
    largest,
    node.getAttribute('src'),
  ]) {
    if (value) {
      const url = mediaUrl(value, base);
      if (url) return url;
    }
  }
  return '';
}
function embeddedVideo(value, base) {
  const src = mediaUrl(value, base);
  if (!src) return null;
  const u = new URL(src);
  if (
    ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(
      u.hostname,
    )
  ) {
    const id = /^\/embed\/([\w-]{11})(?:\/|$)/.exec(u.pathname)?.[1];
    if (id)
      return {
        type: 'video',
        text: '',
        url: `https://www.youtube.com/watch?v=${id}`,
        provider: 'YouTube',
        poster: '',
      };
  }
  if (u.hostname === 'player.vimeo.com') {
    const id = /^\/video\/(\d+)/.exec(u.pathname)?.[1];
    if (id)
      return {
        type: 'video',
        text: '',
        url: `https://vimeo.com/${id}`,
        provider: 'Vimeo',
        poster: '',
      };
  }
  return null;
}
export function extractHtml(html, url) {
  const dom = new JSDOM(html, { url }); // No scripts, subresources or browser execution.
  try {
    const doc = dom.window.document;
    if (
      doc.querySelector('#challenge-running,#cf-challenge-running') ||
      /just a moment|access denied|verify you are human/i.test(doc.title)
    )
      throw new SourceError('access_challenge');
    let restricted = Boolean(doc.querySelector('.paywall,[data-paywall],.subscription-wall'));
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const values = JSON.parse(script.textContent);
        const records = Array.isArray(values) ? values : [values];
        for (const value of records.flatMap((v) => v['@graph'] ?? [v]))
          if (value.isAccessibleForFree === false || value.isAccessibleForFree === 'false')
            restricted = true;
      } catch (_) {}
    }
    const imageUrl = doc.querySelector('meta[property="og:image"]')?.content ?? '';
    // Capture supported video metadata before removing all browser embeds.
    const media = new Map(),
      markerPrefix = `ANDESMEDIA${randomUUID().replaceAll('-', '')}`;
    doc.querySelectorAll(unwanted.replace('iframe,', '')).forEach((node) => node.remove());
    for (const node of [...doc.querySelectorAll('video,iframe')]) {
      let block;
      if (node.tagName === 'VIDEO') {
        const src = mediaUrl(
          node.getAttribute('src') || node.querySelector('source')?.getAttribute('src') || '',
          url,
        );
        if (src)
          block = {
            type: 'video',
            text: clean(node.closest('figure')?.querySelector('figcaption')?.textContent || ''),
            url: src,
            provider: 'direct',
            poster: mediaUrl(node.getAttribute('poster') || '', url),
          };
      } else
        block = embeddedVideo(node.getAttribute('src') || node.getAttribute('data-src') || '', url);
      if (block) {
        const marker = `${markerPrefix}_${media.size}_END`;
        media.set(marker, block);
        const p = doc.createElement('p');
        p.textContent = marker;
        node.replaceWith(p);
      } else node.remove();
    }
    for (const img of doc.querySelectorAll('img')) {
      const src = imageSource(img, url);
      if (src) img.setAttribute('src', src);
      else img.remove();
    }
    const article = new Readability(doc, { charThreshold: 250, maxElemsToParse: 30000 }).parse();
    if (!article?.textContent || clean(article.textContent).length < 250)
      throw new SourceError('insufficient_article');
    const content = new JSDOM(`<body>${article.content}</body>`);
    try {
      const body = content.window.document.body;
      body.querySelectorAll(unwanted).forEach((n) => n.remove());
      const blocks = [];
      const markerPattern = new RegExp(`${markerPrefix}_\\d+_END`, 'g');
      function prose(value, type = 'paragraph') {
        let start = 0;
        for (const match of value.matchAll(markerPattern)) {
          const before = clean(value.slice(start, match.index));
          if (before) blocks.push({ type, text: before });
          blocks.push(media.get(match[0]));
          start = match.index + match[0].length;
        }
        const rest = clean(value.slice(start));
        if (rest) blocks.push({ type, text: rest });
      }
      function walk(node) {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) {
            prose(child.textContent);
            continue;
          }
          if (child.nodeType !== 1) continue;
          const tag = child.tagName.toLowerCase();
          if (tag === 'pre') {
            const text = child.textContent.trim();
            if (text) blocks.push({ type: 'code', text });
          } else if (tag === 'img') {
            const src = imageSource(child, url);
            const width = Number(child.getAttribute('width')),
              height = Number(child.getAttribute('height'));
            if (src && !(width > 0 && width <= 2) && !(height > 0 && height <= 2))
              blocks.push({
                type: 'image',
                text: clean(
                  child.closest('figure')?.querySelector('figcaption')?.textContent || '',
                ),
                alt: clean(child.getAttribute('alt') || ''),
                url: src,
              });
          } else if (tag === 'figcaption') {
            if (!child.parentElement.querySelector('img,video'))
              prose(child.textContent, 'caption');
          } else if (/^h[1-6]$/.test(tag)) {
            prose(child.textContent, 'heading');
          } else if (tag === 'p' || tag === 'li' || tag === 'blockquote') {
            if (child.querySelector('img')) walk(child);
            else
              prose(
                child.textContent,
                tag === 'li' ? 'list' : tag === 'blockquote' ? 'quote' : 'paragraph',
              );
          } else if (tag === 'table') {
            const rows = [...child.querySelectorAll('tr')]
              .filter((r) => r.closest('table') === child)
              .slice(0, 200)
              .map((row) =>
                [...row.children]
                  .filter((c) => ['TH', 'TD'].includes(c.tagName))
                  .slice(0, 50)
                  .map((c) => ({
                    text: clean(c.textContent),
                    header: c.tagName === 'TH',
                    colSpan: Math.max(1, Math.min(50, Number(c.getAttribute('colspan')) || 1)),
                    rowSpan: Math.max(1, Math.min(200, Number(c.getAttribute('rowspan')) || 1)),
                  })),
              );
            const caption = clean(child.querySelector('caption')?.textContent || '');
            const text = [caption, ...rows.map((r) => r.map((c) => c.text).join(' | '))]
              .filter(Boolean)
              .join('\n');
            if (text) blocks.push({ type: 'table', text, caption, rows });
          } else walk(child);
        }
      }
      walk(body);
      const text = blocks
        .map((b) => b.text)
        .filter(Boolean)
        .join('\n\n');
      if (text.length < 250) throw new SourceError('insufficient_article');
      return {
        title: clean(article.title ?? ''),
        author: article.byline ?? '',
        language: article.lang ?? dom.window.document.documentElement.lang ?? '',
        blocks,
        text,
        wordCount: text.split(/\s+/).length,
        imageUrl,
        imageIsFromSource: true,
        coverage: restricted ? 'partial' : 'extracted',
        extractionMethod: 'readability',
        extractionVersion: 2,
        fetchedAt: new Date().toISOString(),
      };
    } finally {
      content.window.close();
    }
  } finally {
    dom.window.close();
  }
}
export class ArticleExtractor {
  constructor({ get = publicGet, robots = new RobotsPolicy(get) } = {}) {
    this.get = get;
    this.robots = robots;
  }
  async nativeReferences(text, url) {
    if (!/https?:\/\//.test(text)) return [];
    return (await resolveScientificReferences(nativeReferencePage(text, url), this)).papers;
  }
  async discoverDocuments(article) {
    if (article.contentKind && article.contentKind !== 'article')
      return { papers: await this.nativeReferences(article.nativeText ?? '', article.url) };
    await this.robots.allowed(article.url);
    const page = await this.get(article.url, {
      metadataForPdf: true,
      timeout: 12000,
      accept: 'text/html,application/xhtml+xml,application/pdf',
    });
    await this.robots.allowed(page.url);
    if (/application\/pdf/i.test(page.type))
      return {
        papers: [
          {
            sourceUrl: page.url,
            pdfUrl: page.url,
            title: article.title,
            provider: new URL(page.url).hostname,
            relation: 'document',
          },
        ],
      };
    if (!/html|xhtml/i.test(page.type)) throw new SourceError('unsupported_content');
    return resolveScientificReferences(page, this);
  }
  async extract(url, candidate = {}) {
    // DEV's public article endpoint explicitly supplies the body, unlike the
    // short description in its listing endpoint. It avoids the website shell.
    if (
      candidate.sourceId === 'dev' &&
      Number.isSafeInteger(candidate.apiArticleId) &&
      candidate.apiArticleId > 0
    ) {
      const result = await this.get(`https://dev.to/api/articles/${candidate.apiArticleId}`);
      const article = JSON.parse(result.body);
      if (typeof article.body_html !== 'string') throw new SourceError('insufficient_article');
      const escapedTitle = String(article.title ?? candidate.title ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
      const extracted = extractHtml(
        `<html><head><title>${escapedTitle}</title></head><body><article>${article.body_html}</article></body></html>`,
        url,
      );
      return {
        ...extracted,
        papers: (await resolveScientificReferences({ body: article.body_html, url }, this)).papers,
        author: typeof article.user?.name === 'string' ? article.user.name : '',
        resolvedUrl: url,
        extractionMethod: 'forem-body-api',
      };
    }
    const arxiv = arxivIdentity(url);
    if (arxiv) url = arxiv.abstractUrl;
    await this.robots.allowed(url);
    const page = await this.get(url, {
      metadataForPdf: true,
      accept: 'text/html,application/xhtml+xml,application/pdf',
    });
    if (/application\/pdf/i.test(page.type)) {
      await this.robots.allowed(page.url);
      const paper = {
        sourceUrl: page.url,
        pdfUrl: page.url,
        title: candidate.title || 'Documento científico',
        provider: new URL(page.url).hostname,
        relation: 'document',
      };
      return {
        blocks: [],
        text: '',
        wordCount: 0,
        coverage: 'unavailable',
        contentScope: 'paper_pdf_only',
        paper,
        papers: [paper],
        extractionVersion: 4,
        extractionMethod: 'pdf-link',
        resolvedUrl: page.url,
        fetchedAt: new Date().toISOString(),
      };
    }
    if (!/html|xhtml/i.test(page.type)) throw new SourceError('unsupported_content');
    // Recheck the final destination too: a publisher redirect can change origins.
    await this.robots.allowed(page.url);
    const scientific = await resolveScientificReferences(page, this);
    if (scientific.paper) {
      const text = scientific.abstract ?? '';
      return {
        blocks: [],
        text,
        wordCount: text ? text.split(/\s+/).length : 0,
        author: scientific.author,
        paper: scientific.paper,
        papers: scientific.papers,
        coverage: 'abstract',
        contentScope: 'paper_abstract',
        summaryScope: 'paper_abstract',
        readingMode: 'scientific_links',
        extractionMethod: 'scientific-author-abstract',
        extractionVersion: 5,
        resolvedUrl: page.url,
        fetchedAt: new Date().toISOString(),
      };
    }
    return {
      ...extractHtml(page.body, page.url),
      resolvedUrl: page.url,
      extractionVersion: 5,
      papers: scientific.papers,
      paperDiscoveryFailures: scientific.failures,
    };
  }
}
