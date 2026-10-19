const defaultAndesEndpoint = 'https://andes-news.cmaquera.com';

class NewsSource {
  final String id, name, region;
  final List<String> aliases;
  const NewsSource(this.id, this.name, this.region, {this.aliases = const []});
  factory NewsSource.fromJson(Map<String, dynamic> j) => NewsSource(
    j['id'] as String,
    j['name'] as String,
    j['region'] as String? ?? 'Global',
    aliases: (j['aliases'] as List? ?? []).cast<String>(),
  );
  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'region': region,
    'aliases': aliases,
  };
}

const sources = [
  NewsSource('gestion', 'Gestión · Tecnología', 'Perú'),
  NewsSource('xataka-mx', 'Xataka México', 'Latinoamérica'),
  NewsSource('genbeta', 'Genbeta', 'Global'),
  NewsSource('github', 'GitHub Changelog', 'Global'),
  NewsSource('dev', 'DEV en español', 'Global'),
  NewsSource('hn', 'Hacker News', 'Global'),
];

class ContentBlock {
  final String type, text, url, alt, poster, provider, caption;
  final List<List<TableCellData>> rows;
  ContentBlock(
    this.type,
    this.text, {
    this.url = '',
    this.alt = '',
    this.poster = '',
    this.provider = '',
    this.caption = '',
    List<List<TableCellData>> rows = const [],
  }) : rows = List.unmodifiable(
         rows.map((row) => List<TableCellData>.unmodifiable(row)),
       );
  factory ContentBlock.fromJson(Map<String, dynamic> j) => ContentBlock(
    j['type'] ?? 'paragraph',
    j['text'] ?? '',
    url: j['url'] ?? '',
    alt: j['alt'] ?? '',
    poster: j['poster'] ?? '',
    provider: j['provider'] ?? '',
    caption: j['caption'] ?? '',
    rows: (j['rows'] as List? ?? [])
        .map((r) => (r as List).map((c) => TableCellData.fromJson(c)).toList())
        .toList(),
  );
  Map<String, dynamic> toJson() => {
    'type': type,
    'text': text,
    if (url.isNotEmpty) 'url': url,
    if (alt.isNotEmpty) 'alt': alt,
    if (poster.isNotEmpty) 'poster': poster,
    if (provider.isNotEmpty) 'provider': provider,
    if (caption.isNotEmpty) 'caption': caption,
    if (rows.isNotEmpty)
      'rows': rows.map((r) => r.map((c) => c.toJson()).toList()).toList(),
  };
}

class TableCellData {
  final String text;
  final bool header;
  final int colSpan, rowSpan;
  const TableCellData(
    this.text, {
    this.header = false,
    this.colSpan = 1,
    this.rowSpan = 1,
  });
  factory TableCellData.fromJson(Map<String, dynamic> j) => TableCellData(
    j['text'] ?? '',
    header: j['header'] == true,
    colSpan: (j['colSpan'] as int? ?? 1).clamp(1, 50),
    rowSpan: (j['rowSpan'] as int? ?? 1).clamp(1, 200),
  );
  Map<String, dynamic> toJson() => {
    'text': text,
    'header': header,
    'colSpan': colSpan,
    'rowSpan': rowSpan,
  };
}

class Article {
  final Map<String, String> paper;
  final String contentScope, summaryScope;
  final String sourceLabel, contentKind, editorialStatus;
  final double? editorialScore;
  final List<String> selectionReasons;
  final List<Map<String, dynamic>> sourceOccurrences;
  final String id,
      title,
      url,
      excerpt,
      sourceId,
      region,
      topic,
      imageUrl,
      titleEs,
      abstract,
      status,
      coverage,
      language,
      author;
  final DateTime? published;
  final int score, comments, wordCount;
  final List<ContentBlock> content, translatedContent;
  final List<String> keyPoints;
  Article({
    required this.id,
    required this.title,
    required this.url,
    this.excerpt = '',
    required this.sourceId,
    required this.region,
    required this.topic,
    this.contentScope = '',
    this.summaryScope = '',
    Map<String, String> paper = const {},
    this.sourceLabel = '',
    this.contentKind = 'article',
    this.editorialStatus = '',
    this.editorialScore,
    List<String> selectionReasons = const [],
    List<Map<String, dynamic>> sourceOccurrences = const [],
    this.imageUrl = '',
    this.published,
    this.score = 0,
    this.comments = 0,
    this.titleEs = '',
    this.abstract = '',
    this.status = 'queued',
    this.coverage = 'unavailable',
    this.language = '',
    this.author = '',
    this.wordCount = 0,
    List<ContentBlock> content = const [],
    List<ContentBlock> translatedContent = const [],
    List<String> keyPoints = const [],
  }) : paper = Map.unmodifiable(paper),
       selectionReasons = List.unmodifiable(selectionReasons),
       sourceOccurrences = List.unmodifiable(
         sourceOccurrences.map((s) => Map<String, dynamic>.unmodifiable(s)),
       ),
       content = List.unmodifiable(content),
       translatedContent = List.unmodifiable(translatedContent),
       keyPoints = List.unmodifiable(keyPoints);
  String get displayTitle => titleEs.isEmpty ? title : titleEs;
  String get sourceName => sourceLabel.isNotEmpty
      ? sourceLabel
      : sources.where((s) => s.id == sourceId).firstOrNull?.name ?? sourceId;
  bool get isNative => contentKind != 'article';
  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'url': url,
    'excerpt': excerpt,
    'sourceId': sourceId,
    'sourceName': sourceLabel,
    'contentKind': contentKind,
    'editorialStatus': editorialStatus,
    'editorialScore': editorialScore,
    'selectionReasons': selectionReasons,
    'sourceOccurrences': sourceOccurrences,
    'region': region,
    'topic': topic,
    'paper': paper,
    'contentScope': contentScope,
    'summaryScope': summaryScope,
    'imageUrl': imageUrl,
    'published': published?.toIso8601String(),
    'score': score,
    'comments': comments,
    'titleEs': titleEs,
    'abstract': abstract,
    'status': status,
    'coverage': coverage,
    'language': language,
    'author': author,
    'wordCount': wordCount,
    'content': content.map((b) => b.toJson()).toList(),
    'translatedContent': translatedContent.map((b) => b.toJson()).toList(),
    'keyPoints': keyPoints.toList(),
  };
  factory Article.fromJson(Map<String, dynamic> j) => Article(
    id: j['id'],
    title: j['title'],
    url: j['url'],
    excerpt: j['feedExcerpt'] ?? j['excerpt'] ?? '',
    sourceId: j['sourceId'],
    sourceLabel: j['sourceName'] ?? '',
    contentKind: j['contentKind'] ?? 'article',
    editorialStatus: j['editorialStatus'] ?? '',
    editorialScore: (j['editorialScore'] as num?)?.toDouble(),
    selectionReasons: (j['selectionReasons'] as List? ?? []).cast<String>(),
    sourceOccurrences: (j['sourceOccurrences'] as List? ?? [])
        .map((s) => Map<String, dynamic>.from(s))
        .toList(),
    region: j['region'],
    topic: j['topic'],
    paper: (j['paper'] as Map? ?? {}).map(
      (k, v) => MapEntry(k.toString(), v.toString()),
    ),
    contentScope: j['contentScope'] ?? '',
    summaryScope: j['summaryScope'] ?? '',
    imageUrl: j['imageUrl'] ?? '',
    published: DateTime.tryParse(j['published'] ?? ''),
    score: j['score'] ?? 0,
    comments: j['comments'] ?? 0,
    titleEs: j['titleEs'] ?? '',
    abstract: j['abstract'] ?? '',
    status: j['status'] ?? 'queued',
    coverage: j['coverage'] ?? 'unavailable',
    language: j['language'] ?? '',
    author: j['author'] ?? '',
    wordCount: j['wordCount'] ?? 0,
    content: (j['content'] as List? ?? [])
        .map((b) => ContentBlock.fromJson(b))
        .toList(),
    translatedContent: (j['translatedContent'] as List? ?? [])
        .map((b) => ContentBlock.fromJson(b))
        .toList(),
    keyPoints: (j['keyPoints'] as List? ?? []).cast<String>(),
  );
}

class FeedResult {
  final List<NewsSource> catalog;
  final List<Article> articles;
  final Map<String, String> errors;
  final String? error;
  final DateTime? collectedAt;
  final Map<String, dynamic> counts;
  FeedResult(
    List<Article> articles,
    Map<String, String> errors, {
    this.error,
    this.collectedAt,
    Map<String, dynamic> counts = const {},
    List<NewsSource> catalog = const [],
  }) : catalog = List.unmodifiable(catalog),
       articles = List.unmodifiable(articles),
       errors = Map.unmodifiable(errors),
       counts = Map.unmodifiable(counts);
}
