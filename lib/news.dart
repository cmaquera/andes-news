import 'dart:convert';

import 'package:http/http.dart' as http;

const defaultAndesEndpoint = 'https://andes-news.cmaquera.com';

class NewsSource {
  final String id, name, region;
  const NewsSource(this.id, this.name, this.region);
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
  const ContentBlock(
    this.type,
    this.text, {
    this.url = '',
    this.alt = '',
    this.poster = '',
    this.provider = '',
    this.caption = '',
    this.rows = const [],
  });
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
  final DateTime? published;
  final int score, comments, wordCount;
  final List<ContentBlock> content, translatedContent;
  final List<String> keyPoints;
  const Article({
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
    this.wordCount = 0,
    this.content = const [],
    this.translatedContent = const [],
    this.keyPoints = const [],
  });
  String get displayTitle => titleEs.isEmpty ? title : titleEs;
  String get sourceName =>
      sources.where((s) => s.id == sourceId).firstOrNull?.name ?? sourceId;
  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'url': url,
    'excerpt': excerpt,
    'sourceId': sourceId,
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
    'keyPoints': keyPoints,
  };
  factory Article.fromJson(Map<String, dynamic> j) => Article(
    id: j['id'],
    title: j['title'],
    url: j['url'],
    excerpt: j['feedExcerpt'] ?? j['excerpt'] ?? '',
    sourceId: j['sourceId'],
    region: j['region'],
    topic: j['topic'],
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
  final List<Article> articles;
  final Map<String, String> errors;
  final String? error;
  final DateTime? collectedAt;
  final Map<String, dynamic> counts;
  FeedResult(
    this.articles,
    this.errors, {
    this.error,
    this.collectedAt,
    this.counts = const {},
  });
}

class FeedException implements Exception {
  final String message;
  const FeedException(this.message);
  @override
  String toString() => message;
}

bool validAndesEndpoint(String value) {
  final u = Uri.tryParse(value);
  return u != null &&
      u.hasAuthority &&
      u.userInfo.isEmpty &&
      u.query.isEmpty &&
      u.fragment.isEmpty &&
      (u.scheme == 'https' ||
          (u.scheme == 'http' &&
              ['127.0.0.1', 'localhost', '10.0.2.2'].contains(u.host)));
}

class NewsService {
  final http.Client client;
  String endpoint, token;
  NewsService({
    http.Client? client,
    this.endpoint = defaultAndesEndpoint,
    this.token = '',
  }) : client = client ?? http.Client();
  void configure(String value, String credential) {
    endpoint = value;
    token = credential;
  }

  Future<Map<String, dynamic>> getJson(String path) async {
    if (!validAndesEndpoint(endpoint)) {
      throw const FeedException('Configura la URL HTTPS de Andes en Ajustes.');
    }
    if (token.length < 32) {
      throw const FeedException(
        'Configura tu token de acceso en Ajustes para cargar las noticias del servidor.',
      );
    }
    final request = http.Request(
      'GET',
      Uri.parse('${endpoint.replaceFirst(RegExp(r'/$'), '')}$path'),
    )..followRedirects = false;
    request.headers['Authorization'] = 'Bearer $token';
    final r = await http.Response.fromStream(
      await client.send(request).timeout(const Duration(seconds: 25)),
    ).timeout(const Duration(seconds: 25));
    if (r.statusCode == 401) {
      throw const FeedException('El token no es válido. Revísalo en Ajustes.');
    }
    if (r.statusCode == 404 || r.statusCode == 410) {
      throw const FeedException(
        'Actualiza el backend de Andes a la versión 0.3.',
      );
    }
    if (r.statusCode != 200) {
      throw const FeedException(
        'El servidor no pudo responder. Inténtalo de nuevo.',
      );
    }
    return jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
  }

  Future<FeedResult> load(Set<String> enabled) async {
    try {
      final data = await getJson('/articles?limit=200');
      final rows = (data['articles'] as List)
          .map((j) => Article.fromJson(j))
          .where((a) => enabled.contains(a.sourceId))
          .toList();
      final collection = data['collection'] as Map<String, dynamic>?;
      return FeedResult(
        rows,
        (collection?['errors'] as Map<String, dynamic>? ?? {}).map(
          (key, value) => MapEntry(key, value.toString()),
        ),
        collectedAt: DateTime.tryParse(collection?['completedAt'] ?? ''),
        counts: data['counts'] ?? {},
      );
    } on FeedException catch (e) {
      return FeedResult([], {}, error: e.message);
    } catch (_) {
      return FeedResult(
        [],
        {},
        error: 'No se pudo conectar con Andes. Conservamos tu última carga.',
      );
    }
  }

  Future<Article> detail(String id) async {
    if (!RegExp(r'^[a-f0-9]{32}$').hasMatch(id)) {
      throw const FeedException(
        'Esta noticia proviene de la versión anterior. Búscala de nuevo en el feed del servidor.',
      );
    }
    return Article.fromJson((await getJson('/articles/$id'))['article']);
  }
}
