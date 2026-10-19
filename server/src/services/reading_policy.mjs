export function isScientificDocument(article) {
  if (article.contentKind && article.contentKind !== 'article') return false;
  return (
    article.readingMode === 'scientific_links' ||
    ['paper', 'paper_record', 'paper_pdf_only', 'paper_abstract', 'arxiv_abstract'].includes(
      article.contentScope,
    ) ||
    Boolean(
      article.paper && Object.keys(article.paper).length && article.paper.relation !== 'reference',
    ) ||
    Boolean(article.papers?.some((p) => p.relation === 'document'))
  );
}

export function readerArticle(article) {
  if (!isScientificDocument(article)) return article;
  return { ...article, readingMode: 'scientific_links', content: [], translatedContent: [] };
}
