import { JSDOM } from 'jsdom';

export function arxivIdentity(value) {
  try {
    const url = new URL(value);
    if (
      !['arxiv.org', 'www.arxiv.org', 'export.arxiv.org'].includes(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    const match =
      /^\/(?:abs|html|pdf)\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?\/?$/.exec(
        url.pathname,
      );
    return match ? { id: match[1], abstractUrl: `https://arxiv.org/abs/${match[1]}` } : null;
  } catch {
    return null;
  }
}

// Only offer formats advertised by the official record for this paper/version.
export function arxivFormats(html, value) {
  const identity = arxivIdentity(value);
  if (!identity) return null;
  const dom = new JSDOM(html, { url: value });
  try {
    const paper = { ...identity };
    for (const node of dom.window.document.querySelectorAll(
      'a[href],meta[name="citation_pdf_url"]',
    )) {
      const raw = node.getAttribute('href') ?? node.getAttribute('content');
      let url;
      try {
        url = new URL(raw, value);
      } catch {
        continue;
      }
      const target = arxivIdentity(url.href);
      if (!target || target.id.replace(/v\d+$/, '') !== identity.id.replace(/v\d+$/, '')) continue;
      if (/v\d+$/.test(identity.id) && target.id !== identity.id) continue;
      if (url.pathname.startsWith('/pdf/')) paper.pdfUrl = `https://arxiv.org${url.pathname}`;
      if (url.pathname.startsWith('/html/')) paper.htmlUrl = `https://arxiv.org${url.pathname}`;
    }
    const authors = [...dom.window.document.querySelectorAll('meta[name="citation_author"]')]
      .map((n) => n.content)
      .filter(Boolean);
    return { paper, author: authors.join(', ') };
  } finally {
    dom.window.close();
  }
}
