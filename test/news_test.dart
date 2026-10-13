import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:andes_news/news.dart';

void main() {
  test(
    'Loads prepared articles from Andes only, preserving translated abstract',
    () async {
      final client = MockClient((r) async {
        expect(r.url.host, 'andes-news.cmaquera.com');
        expect(r.url.path, '/articles');
        expect(r.headers['Authorization'], 'Bearer ${'x' * 32}');
        return http.Response(
          jsonEncode({
            'articles': [
              {
                'id': 'a' * 32,
                'title': 'English original',
                'titleEs': 'Titular español',
                'url': 'https://example.com/a',
                'sourceId': 'hn',
                'region': 'Global',
                'topic': 'Programación',
                'abstract': 'Abstracto completo.',
                'status': 'ready',
                'coverage': 'extracted',
              },
            ],
            'collection': null,
            'counts': {'ready': 1},
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      final result = await NewsService(
        client: client,
        token: 'x' * 32,
      ).load({'hn'});
      expect(result.error, isNull);
      expect(result.articles.single.displayTitle, 'Titular español');
      expect(result.articles.single.abstract, 'Abstracto completo.');
    },
  );
  test(
    'Token/network errors are surfaced so the app retains offline cache',
    () async {
      final service = NewsService(
        client: MockClient((r) async => http.Response('{}', 401)),
        token: 'x' * 32,
      );
      expect((await service.load({'hn'})).error, contains('token'));
      expect(validAndesEndpoint('http://192.168.0.200:8787'), false);
      expect(validAndesEndpoint('https://secret@api.example.com'), false);
    },
  );
  test('Clean body and translation survive cache roundtrip', () {
    final article = Article(
      id: 'test',
      title: 'Original',
      url: 'https://example.com',
      sourceId: 'hn',
      region: 'Global',
      topic: 'Programación',
      abstract: 'Abstracto',
      content: [ContentBlock('code', 'print("hello")')],
      translatedContent: [ContentBlock('paragraph', 'Texto español')],
    );
    final restored = Article.fromJson(article.toJson());
    expect(restored.content.single.text, 'print("hello")');
    expect(restored.translatedContent.single.text, 'Texto español');
  });
}
