const defaultAndesEndpoint = 'https://andes-news.cmaquera.com';

class NewsSource {
  final String id, name, region;
  final List<String> aliases;
  const NewsSource(this.id, this.name, this.region, [this.aliases = const []]);

  factory NewsSource.fromJson(Map<String, dynamic> j) {
    final rawAliases = j['aliases'] as List? ?? [];
    return NewsSource(
      j['id']?.toString() ?? '',
      j['name']?.toString() ?? '',
      j['region']?.toString() ?? 'Global',
      rawAliases.map((e) => e.toString()).toList(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'region': region,
    'aliases': aliases,
  };
}

const defaultSources = [
  NewsSource('hackernews', 'Hacker News', 'Global', ['hn']),
  NewsSource('reddit', 'Reddit r/LocalLLaMA', 'Global'),
  NewsSource('github', 'GitHub Trending AI & Software', 'Global'),
  NewsSource('rss', 'The Verge - AI Tech', 'Global'),
  NewsSource('x', 'Andrej Karpathy (X/Twitter)', 'Global'),
  NewsSource('telegram', 'Telegram Kubernetes News', 'Global'),
];

// Deprecated compatibility alias for legacy tests:
const sources = defaultSources;

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
  final String _sourceName;
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
    this._sourceName = '',
    this.wordCount = 0,
    List<ContentBlock> content = const [],
    List<ContentBlock> translatedContent = const [],
    List<String> keyPoints = const [],
  }) : content = List.unmodifiable(content),
       translatedContent = List.unmodifiable(translatedContent),
       keyPoints = List.unmodifiable(keyPoints);
  String get displayTitle => titleEs.isEmpty ? title : titleEs;
  String get sourceName => _sourceName.isNotEmpty
      ? _sourceName
      : (sources.where((s) => s.id == sourceId).firstOrNull?.name ?? sourceId);
  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'url': url,
    'excerpt': excerpt,
    'sourceId': sourceId,
    'sourceName': sourceName,
    'region': region,
    'topic': topic,
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
  factory Article.fromJson(Map<String, dynamic> j) {
    if (j['id'] == null || j['title'] == null) {
      throw const FormatException('Invalid article JSON: missing id or title');
    }
    return Article(
      id: j['id'].toString(),
      title: j['title'].toString(),
      url: j['url']?.toString() ?? '',
      excerpt: j['feedExcerpt']?.toString() ?? j['excerpt']?.toString() ?? '',
      sourceId: j['sourceId']?.toString() ?? '',
      sourceName: j['sourceName']?.toString() ?? '',
      region: j['region']?.toString() ?? 'Global',
      topic: j['topic']?.toString() ?? 'software',
      imageUrl: j['imageUrl']?.toString() ?? '',
      published: DateTime.tryParse(j['published']?.toString() ?? ''),
      score: j['score'] is num ? (j['score'] as num).toInt() : 0,
      comments: j['comments'] is num ? (j['comments'] as num).toInt() : 0,
      titleEs: j['titleEs']?.toString() ?? '',
      abstract: j['abstract']?.toString() ?? '',
      status: j['status']?.toString() ?? 'ready',
      coverage: j['coverage']?.toString() ?? 'available',
      language: j['language']?.toString() ?? '',
      author: j['author']?.toString() ?? '',
      wordCount: j['wordCount'] is num ? (j['wordCount'] as num).toInt() : 0,
      content: (j['content'] as List? ?? [])
          .map((b) => ContentBlock.fromJson(b))
          .toList(),
      translatedContent: (j['translatedContent'] as List? ?? [])
          .map((b) => ContentBlock.fromJson(b))
          .toList(),
      keyPoints: (j['keyPoints'] as List? ?? [])
          .map((e) => e.toString())
          .toList(),
    );
  }
}

class FeedResult {
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
  }) : articles = List.unmodifiable(articles),
       errors = Map.unmodifiable(errors),
       counts = Map.unmodifiable(counts);
}
