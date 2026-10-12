import 'dart:io';
import 'dart:convert';

import 'package:andes_news/news.dart';

Future<void> main() async {
  final service = NewsService();
  try {
    final result = await service.load(sources.map((s) => s.id).toSet());
    for (final s in sources) {
      final count = result.articles.where((a) => a.sourceId == s.id).length;
      stdout.writeln(
        '${s.name}: $count noticias${result.errors.containsKey(s.id) ? ' — ${result.errors[s.id]}' : ''}',
      );
    }
    if (result.articles.isEmpty) throw StateError('No sources available');
    await Directory('build').create(recursive: true);
    await File('build/preview-feed.json').writeAsString(
      jsonEncode(result.articles.map((a) => a.toJson()).toList()),
    );
  } finally {
    service.client.close();
  }
}
