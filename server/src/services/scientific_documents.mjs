import { JSDOM } from 'jsdom';
import { publicUrl } from './public_http.mjs';
import { arxivIdentity, arxivFormats } from './arxiv.mjs';

const clean = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const scientificLabel =
  /\b(paper|study|research|preprint|publication|estudio|investigaci[oó]n|art[ií]culo cient[ií]fico|documento cient[ií]fico)\b/i;
const excluded =
  /supplement|supporting|appendix|correction|erratum|figure|poster|slide|suplement|anexo/i;
export const MAX_PAPER_REFERENCES = 3;

export function nativeReferencePage(text, url) {
  const dom = new JSDOM('<body><article></article></body>');
  try {
    const article = dom.window.document.querySelector('article');
    for (const match of text.matchAll(/https?:\/\/[^\s<>"\]]+/g)) {
      const target = safe(match[0].replace(/[.,;!?)]+$/, ''), url);
      if (!target) continue;
      const a = dom.window.document.createElement('a');
      a.href = target;
      a.textContent = text.slice(
        Math.max(0, match.index - 150),
        match.index + match[0].length + 150,
      );
      article.append(a);
    }
    return { url, body: dom.serialize() };
  } finally {
    dom.window.close();
  }
}

function safe(value, base) {
  if (!value) return '';
  try {
    const u = publicUrl(new URL(value, base).href);
    u.hash = '';
    return u.href;
  } catch {
    return '';
  }
}
function doi(value) {
  return (
    /(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)/i
      .exec(clean(value))?.[1]
      ?.replace(/[.,;]$/, '') ?? ''
  );
}
function records(doc) {
  const rows = [];
  for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(node.textContent);
      rows.push(
        ...(Array.isArray(data) ? data : [data])
          .flatMap((x) => x?.['@graph'] ?? [x])
          .filter((x) => x && typeof x === 'object'),
      );
    } catch {}
  }
  return rows;
}

// Metadata identifies the document; ordinary PDF links in a news story do not.
export function scientificDocuments(html, url) {
  const arxiv = arxivFormats(html, url);
  if (arxiv)
    return {
      paper: { ...arxiv.paper, sourceUrl: url, provider: 'arXiv', relation: 'document' },
      author: arxiv.author,
      references: [],
    };
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document,
      meta = new Map();
    for (const node of doc.querySelectorAll('meta[name],meta[property]')) {
      const key = (node.getAttribute('name') ?? node.getAttribute('property')).toLowerCase();
      if (!meta.has(key)) meta.set(key, node.content);
    }
    const get = (...keys) => keys.map((k) => meta.get(k)).find(Boolean) ?? '';
    const schemas = records(doc);
    const isNews = schemas.some((r) =>
      [r['@type']].flat().some((t) => /(?:^|\/)NewsArticle$/.test(t ?? '')),
    );
    const scholarly = schemas.filter((r) =>
      [r['@type']]
        .flat()
        .some((t) =>
          /(?:^|\/)(?:ScholarlyArticle|MedicalScholarlyArticle|Thesis|Report)$/.test(t ?? ''),
        ),
    );
    const schema =
      scholarly.find(
        (r) => safe(r.url ?? r.mainEntityOfPage?.['@id'] ?? r['@id'], url) === safe(url, url),
      ) ??
      (scholarly.length === 1 && !schemas.some((r) => [r['@type']].flat().includes('NewsArticle'))
        ? scholarly[0]
        : undefined);
    const title = clean(
      get('citation_title', 'bepress_citation_title', 'prism.title', 'dc.title', 'dcterms.title') ||
        schema?.headline ||
        schema?.name,
    );
    const isPaper = Boolean(
      !isNews &&
      title &&
      (schema ||
        (/article|thesis|dissertation|preprint|report|conferencepaper/i.test(
          get('dc.type', 'dcterms.type'),
        ) &&
          get('dc.creator', 'dcterms.creator')) ||
        get(
          'citation_author',
          'bepress_citation_author',
          'citation_doi',
          'prism.doi',
          'citation_journal_title',
          'citation_conference_title',
          'citation_pdf_url',
          'citation_fulltext_html_url',
        )),
    );
    if (isPaper) {
      const paper = {
        title,
        sourceUrl: safe(url, url),
        provider: new URL(url).hostname,
        relation: 'document',
      };
      const identifier = doi(
        get('citation_doi', 'prism.doi', 'dc.identifier') ||
          schema?.identifier?.value ||
          schema?.identifier ||
          '',
      );
      if (identifier) paper.doi = identifier;
      paper.pdfUrl = safe(get('citation_pdf_url', 'bepress_citation_pdf_url'), url);
      if (!paper.pdfUrl) {
        for (const n of doc.querySelectorAll('meta[name]'))
          if (/^(dc|dcterms)\.identifier$/i.test(n.name) && /\.pdf(?:[?#]|$)/i.test(n.content))
            paper.pdfUrl ||= safe(n.content, url);
      }
      paper.htmlUrl = safe(get('citation_fulltext_html_url'), url);
      for (const media of [schema?.encoding, schema?.associatedMedia].flat().filter(Boolean)) {
        if (/pdf/i.test(media.encodingFormat ?? media.fileFormat ?? ''))
          paper.pdfUrl ||= safe(media.contentUrl ?? media.url, url);
        if (/html/i.test(media.encodingFormat ?? media.fileFormat ?? ''))
          paper.htmlUrl ||= safe(media.contentUrl ?? media.url, url);
      }
      for (const link of doc.querySelectorAll('link[rel~="alternate"][href],a[href]')) {
        if (link.closest('nav,footer,aside,.references,#references,[role="doc-bibliography"]'))
          continue;
        const label = clean(link.textContent),
          type = link.getAttribute('type') ?? '';
        if (excluded.test(label + ' ' + link.getAttribute('href'))) continue;
        if (
          /application\/pdf/i.test(type) ||
          /\.pdf(?:[?#]|$)/i.test(link.getAttribute('href') ?? '') ||
          /^(?:download\s+)?(?:full[ -]?text\s+)?pdf(?:\s*\([^)]*\))?$/i.test(label)
        )
          paper.pdfUrl ||= safe(link.getAttribute('href'), url);
        if (
          /text\/html/i.test(type) ||
          /^(?:(?:view|read)\s+)?(?:full[ -]?text(?:\s+html)?|html(?:\s+full[ -]?text)?)$/i.test(
            label,
          )
        )
          paper.htmlUrl ||= safe(link.getAttribute('href'), url);
      }
      // A landing/abstract page is not automatically a full HTML paper.
      if (
        !paper.htmlUrl &&
        (schema?.articleBody ||
          doc.querySelector('.fulltext,.article-body,#article-body,#fulltext,article section h2'))
      )
        paper.htmlUrl = safe(url, url);
      const authors = [
        ...doc.querySelectorAll(
          'meta[name="citation_author"],meta[name="bepress_citation_author"]',
        ),
      ].map((n) => n.content);
      return { paper, author: authors.join(', '), references: [] };
    }
    const references = [],
      seen = new Set();
    const add = (value, label = '', explicit = false, context = label) => {
      const target = safe(value, url);
      if (
        !target ||
        target === safe(url, url) ||
        seen.has(target) ||
        references.length >= MAX_PAPER_REFERENCES
      )
        return;
      const u = new URL(target);
      if (
        !explicit &&
        !arxivIdentity(target) &&
        !['doi.org', 'dx.doi.org'].includes(u.hostname) &&
        !scientificLabel.test(context)
      )
        return;
      seen.add(target);
      references.push({ url: target, title: clean(label).slice(0, 250) });
    };
    for (const r of schemas)
      for (const citation of [r.citation].flat().filter(Boolean)) {
        if (typeof citation === 'object')
          add(citation.url ?? citation['@id'], citation.name ?? citation.headline, true);
        else if (/^https:\/\//i.test(citation)) add(citation, '', true);
      }
    const body = doc.querySelector('article,[role="main"],main') ?? doc.body;
    for (const link of body.querySelectorAll('a[href]')) {
      if (
        link.closest(
          'nav,footer,aside,.related-articles,.related-posts,.references,#references,[role="doc-bibliography"]',
        )
      )
        continue;
      add(
        link.getAttribute('href'),
        link.textContent,
        (link.getAttribute('rel') ?? '').split(/\s+/).includes('cite'),
        link.closest('p,li,blockquote')?.textContent ?? link.textContent,
      );
    }
    return { paper: null, author: '', references };
  } finally {
    dom.window.close();
  }
}

export async function resolveScientificReferences(page, { get, robots }) {
  const found = scientificDocuments(page.body, page.url);
  if (found.paper) return { ...found, papers: [found.paper], failures: [] };
  const papers = [],
    failures = [],
    seen = new Set();
  for (const reference of found.references) {
    try {
      await robots.allowed(reference.url);
      const linked = await get(reference.url, {
        metadataForPdf: true,
        timeout: 12000,
        accept: 'text/html,application/xhtml+xml,application/pdf',
      });
      await robots.allowed(linked.url);
      let paper;
      if (/application\/pdf/i.test(linked.type))
        paper = {
          sourceUrl: linked.url,
          pdfUrl: linked.url,
          title: reference.title || 'Documento citado',
          provider: new URL(linked.url).hostname,
        };
      else if (/html|xhtml/i.test(linked.type))
        paper = scientificDocuments(linked.body, linked.url).paper;
      if (!paper) continue;
      const key = paper.doi || paper.id || paper.pdfUrl || paper.sourceUrl;
      if (!seen.has(key)) {
        seen.add(key);
        papers.push({ ...paper, relation: 'reference' });
      }
    } catch (error) {
      failures.push({ url: reference.url, code: error.code ?? 'document_unavailable' });
    }
  }
  return { ...found, papers, failures };
}
