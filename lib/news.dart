import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:xml/xml.dart';

class NewsSource {
  final String id, name, region, url, kind;
  const NewsSource(
    this.id,
    this.name,
    this.region,
    this.url, [
    this.kind = 'rss',
  ]);
}

const sources = [
  NewsSource(
    'gestion',
    'Gestión · Tecnología',
    'Perú',
    'https://gestion.pe/arc/outboundfeeds/rss/category/tecnologia/?outputType=xml',
  ),
  NewsSource(
    'xataka-mx',
    'Xataka México',
    'Latinoamérica',
    'https://www.xataka.com.mx/rss2.xml',
  ),
  NewsSource(
    'genbeta',
    'Genbeta',
    'Global',
    'https://www.genbeta.com/rss2.xml',
  ),
  NewsSource(
    'github',
    'GitHub Changelog',
    'Global',
    'https://github.blog/changelog/feed/',
  ),
  NewsSource(
    'dev',
    'DEV en español',
    'Global',
    'https://dev.to/api/articles?tag=spanish&per_page=25',
    'dev',
  ),
  NewsSource(
    'hn',
    'Hacker News',
    'Global',
    'https://hacker-news.firebaseio.com/v0/topstories.json',
    'hn',
  ),
];
String cleanText(String input) {
  var text = input
      .replaceAll(
        RegExp(r'<(script|style)[\s\S]*?</\1>', caseSensitive: false),
        ' ',
      )
      .replaceAll(RegExp(r'<[^>]*>'), ' ');
  text = text.replaceAllMapped(RegExp(r'&#(x[0-9a-fA-F]+|\d+);'), (m) {
    final s = m[1]!;
    final code = s.startsWith('x')
        ? int.tryParse(s.substring(1), radix: 16)
        : int.tryParse(s);
    return code != null && code > 0 && code <= 0x10ffff
        ? String.fromCharCode(code)
        : '';
  });
  for (final e in {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&nbsp;': ' ',
  }.entries) {
    text = text.replaceAll(e.key, e.value);
  }
  return text.replaceAll(RegExp(r'\s+'), ' ').trim();
}

String topicOf(String text) {
  final t = text.toLowerCase();
  if (RegExp(
    r'\b(ai|ia|llm|gpt|claude|gemini|inteligencia artificial|machine learning)\b',
  ).hasMatch(t)) {
    return 'IA';
  }
  if (RegExp(r'seguridad|security|vulnerab|ciber|cyber|malware').hasMatch(t)) {
    return 'Seguridad';
  }
  if (RegExp(r'github|open.source|código abierto').hasMatch(t)) {
    return 'Open source';
  }
  if (RegExp(
    r'program|developer|desarroll|python|javascript|typescript|rust\b|linux|software|api\b|docker|kubernetes|code|coding|database|sql\b|react|flutter|backend|frontend|compiler',
  ).hasMatch(t)) {
    return 'Programación';
  }
  return 'Tecnología';
}

class Article {
  final String id, title, url, excerpt, sourceId, region, topic;
  final String imageUrl;
  final DateTime? published;
  final int score, comments;
  const Article({
    required this.id,
    required this.title,
    required this.url,
    required this.excerpt,
    required this.sourceId,
    required this.region,
    required this.topic,
    this.published,
    this.score = 0,
    this.comments = 0,
    this.imageUrl = '',
  });
  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'url': url,
    'excerpt': excerpt,
    'sourceId': sourceId,
    'region': region,
    'topic': topic,
    'published': published?.toIso8601String(),
    'score': score,
    'comments': comments,
    'imageUrl': imageUrl,
  };
  factory Article.fromJson(Map<String, dynamic> j) => Article(
    id: j['id'],
    imageUrl: j['imageUrl'] ?? '',
    title: j['title'],
    url: j['url'],
    excerpt: j['excerpt'],
    sourceId: j['sourceId'],
    region: j['region'],
    topic: j['topic'],
    published: DateTime.tryParse(j['published'] ?? ''),
    score: j['score'] ?? 0,
    comments: j['comments'] ?? 0,
  );
  String get sourceName => sources.firstWhere((s) => s.id == sourceId).name;
}

DateTime? parseDate(String value) {
  final iso = DateTime.tryParse(value);
  if (iso != null) return iso.toUtc();
  try {
    final match = RegExp(r'([+-])(\d{2})(\d{2})$').firstMatch(value);
    final date = DateFormat('EEE, dd MMM yyyy HH:mm:ss', 'en_US').parseStrict(
      value.replaceFirst(RegExp(r' (GMT|UTC|[+-]\d{4})$'), ''),
      true,
    );
    if (match == null) return date;
    final minutes = int.parse(match[2]!) * 60 + int.parse(match[3]!);
    return date.subtract(
      Duration(minutes: match[1] == '+' ? minutes : -minutes),
    );
  } catch (_) {
    return null;
  }
}

List<Article> parseRss(String body, NewsSource source) {
  final doc = XmlDocument.parse(body);
  var nodes = doc.findAllElements('item').toList();
  if (nodes.isEmpty) {
    nodes = doc.descendants
        .whereType<XmlElement>()
        .where((e) => e.name.local == 'entry')
        .toList();
  }
  String field(XmlElement e, String name) =>
      e.childElements
          .where((c) => c.name.local == name)
          .map((c) => c.innerText)
          .firstOrNull ??
      '';
  return nodes
      .take(35)
      .map((e) {
        final title = cleanText(field(e, 'title'));
        final linkNode = e.childElements
            .where(
              (c) =>
                  c.name.local == 'link' &&
                  (c.getAttribute('rel') ?? 'alternate') == 'alternate',
            )
            .firstOrNull;
        final url = linkNode?.getAttribute('href') ?? field(e, 'link');
        final excerpt = cleanText(
          field(e, 'description').isNotEmpty
              ? field(e, 'description')
              : field(e, 'summary'),
        );
        final media = e.descendants
            .whereType<XmlElement>()
            .where(
              (c) =>
                  (c.name.local == 'content' ||
                      c.name.local == 'thumbnail' ||
                      c.name.local == 'enclosure') &&
                  (c.getAttribute('type') ?? 'image').startsWith('image') &&
                  c.getAttribute('url') != null,
            )
            .firstOrNull;
        final imageMatch = RegExp(
          r'''<img[^>]+src=["']([^"']+)["']''',
          caseSensitive: false,
        ).firstMatch(field(e, 'description'));
        final image = media?.getAttribute('url') ?? imageMatch?.group(1) ?? '';
        return Article(
          id: url,
          title: title,
          imageUrl: Uri.tryParse(image)?.scheme == 'https' ? image : '',
          url: url,
          excerpt: excerpt.length > 1800 ? excerpt.substring(0, 1800) : excerpt,
          sourceId: source.id,
          region: source.region,
          topic: topicOf('$title $excerpt'),
          published: parseDate(
            field(e, 'pubDate').isNotEmpty
                ? field(e, 'pubDate')
                : field(e, 'published'),
          ),
        );
      })
      .where(
        (a) =>
            a.title.isNotEmpty &&
            ['https', 'http'].contains(Uri.tryParse(a.url)?.scheme),
      )
      .toList();
}

class FeedResult {
  final List<Article> articles;
  final Map<String, String> errors;
  FeedResult(this.articles, this.errors);
}

class NewsService {
  final http.Client client;
  NewsService({http.Client? client}) : client = client ?? http.Client();
  Future<String> get(String url) async {
    final r = await client
        .get(
          Uri.parse(url),
          headers: {'User-Agent': 'AndesNews/1.0 (personal news reader)'},
        )
        .timeout(const Duration(seconds: 18));
    if (r.statusCode != 200) throw Exception('HTTP ${r.statusCode}');
    return utf8.decode(r.bodyBytes);
  }

  Future<List<Article>> loadSource(NewsSource s) async {
    final body = await get(s.url);
    if (s.kind == 'rss') return parseRss(body, s);
    if (s.kind == 'dev') {
      return (jsonDecode(body) as List)
          .map(
            (j) => Article(
              id: j['url'],
              title: cleanText(j['title']),
              imageUrl: j['cover_image'] ?? j['social_image'] ?? '',
              url: j['url'],
              excerpt: cleanText(j['description'] ?? ''),
              sourceId: s.id,
              region: s.region,
              topic: topicOf('${j['title']} ${j['tag_list']}'),
              published: DateTime.tryParse(j['published_at'] ?? ''),
              score: j['positive_reactions_count'] ?? 0,
              comments: j['comments_count'] ?? 0,
            ),
          )
          .toList();
    }
    final ids = (jsonDecode(body) as List).take(40);
    final articles = <Article>[];
    for (var start = 0; start < ids.length; start += 8) {
      await Future.wait(
        ids.skip(start).take(8).map((id) async {
          try {
            final j = jsonDecode(
              await get('https://hacker-news.firebaseio.com/v0/item/$id.json'),
            );
            if (j == null ||
                j['deleted'] == true ||
                j['dead'] == true ||
                j['type'] != 'story') {
              return;
            }
            final title = cleanText(j['title'] ?? '');
            final topic = topicOf(title);
            if (topic == 'Tecnología') return;
            final url = j['url'] ?? 'https://news.ycombinator.com/item?id=$id';
            if (!['https', 'http'].contains(Uri.tryParse(url)?.scheme)) return;
            articles.add(
              Article(
                id: url,
                title: title,
                url: url,
                excerpt: cleanText(j['text'] ?? ''),
                sourceId: s.id,
                region: s.region,
                topic: topic,
                published: DateTime.fromMillisecondsSinceEpoch(
                  (j['time'] as int) * 1000,
                  isUtc: true,
                ),
                score: j['score'] ?? 0,
                comments: j['descendants'] ?? 0,
              ),
            );
          } catch (_) {
            /* An unavailable item is skipped. */
          }
        }),
      );
    }
    return articles;
  }

  Future<FeedResult> load(Set<String> enabled) async {
    final errors = <String, String>{};
    final batches = await Future.wait(
      sources.where((s) => enabled.contains(s.id)).map((s) async {
        try {
          final articles = await loadSource(s);
          if (articles.isEmpty) errors[s.id] = 'Sin publicaciones disponibles';
          return articles;
        } catch (_) {
          errors[s.id] = 'No se pudo consultar. Reintenta más tarde.';
          return <Article>[];
        }
      }),
    );
    final unique = <String, Article>{};
    for (final a in batches.expand((a) => a)) {
      // Keep query parameters: Hacker News discussions use the same path with different IDs.
      final u = Uri.parse(a.url);
      final key = u
          .replace(
            fragment: '',
            queryParameters: {
              for (final e in u.queryParameters.entries)
                if (!e.key.startsWith('utm_')) e.key: e.value,
            },
          )
          .toString();
      unique.putIfAbsent(key, () => a);
    }
    final articles = unique.values.toList()
      ..sort((a, b) {
        int weight(Article x) =>
            (x.region == 'Perú'
                ? 20
                : x.region == 'Latinoamérica'
                ? 10
                : 0) +
            (x.topic != 'Tecnología' ? 8 : 0);
        final dayA =
            (a.published?.millisecondsSinceEpoch ?? 0) ~/
            Duration.millisecondsPerDay;
        final dayB =
            (b.published?.millisecondsSinceEpoch ?? 0) ~/
            Duration.millisecondsPerDay;
        final freshness = dayB.compareTo(dayA);
        return freshness != 0 ? freshness : weight(b).compareTo(weight(a));
      });
    return FeedResult(articles, errors);
  }
}
