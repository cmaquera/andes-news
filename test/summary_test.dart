import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:andes_news/news.dart';
import 'package:andes_news/summary.dart';

const article = Article(
  id: 'test',
  title: 'Title',
  url: 'https://example.com',
  excerpt: 'Excerpt',
  sourceId: 'hn',
  region: 'Global',
  topic: 'Programación',
);
void main() {
  test('Rejects credentials in URLs and public unencrypted endpoints', () {
    expect(validSummaryEndpoint('https://api.example.com'), true);
    expect(validSummaryEndpoint('http://10.0.2.2:8787'), true);
    expect(validSummaryEndpoint('http://api.example.com'), false);
    expect(validSummaryEndpoint('https://secret@api.example.com'), false);
  });
  test(
    'Sends bearer token and validates translated title and summary',
    () async {
      final service = SummaryService(
        client: MockClient((r) async {
          expect(r.headers['Authorization'], 'Bearer ${'x' * 32}');
          expect(r.url.path, '/summary');
          expect(jsonDecode(r.body)['title'], 'Title');
          return http.Response(
            jsonEncode({
              'titleEs': 'Titular',
              'summary': 'Resumen',
              'basis': 'excerpt',
            }),
            200,
          );
        }),
      );
      final result = await service.generate(
        article,
        'https://api.example.com',
        'x' * 32,
      );
      expect(result.titleEs, 'Titular');
      expect(result.summary, 'Resumen');
    },
  );
  test(
    'Shows useful authentication error and rejects malformed model output',
    () async {
      final service = SummaryService(
        client: MockClient((r) async => http.Response('{}', 401)),
      );
      await expectLater(
        service.generate(article, 'https://api.example.com', 'x' * 32),
        throwsA(isA<SummaryException>()),
      );
      expect(
        () => NewsSummary.fromJson({'summary': 'text'}),
        throwsFormatException,
      );
    },
  );
}
