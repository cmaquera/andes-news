import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:andes_news/app/andes_app.dart';
import 'package:andes_news/app/providers.dart';
import 'package:andes_news/core/network/news_service.dart';
import 'package:andes_news/data/models/article.dart';

void registerAppFlow() {
  testWidgets(
    'Full flow preserves legacy data, reads Spanish/original, bookmarks and settings',
    (tester) async {
      const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      final metadata = {
        'id': id,
        'title': 'Python release',
        'titleEs': 'Python mejora su API',
        'url': 'https://example.com/article',
        'sourceId': 'hn',
        'region': 'Global',
        'topic': 'Programación',
        'abstract': 'Una API para desarrolladores.',
        'status': 'ready',
      };
      final detail = {
        ...metadata,
        'content': [
          {'type': 'paragraph', 'text': 'Original article body.'},
        ],
        'translatedContent': [
          {'type': 'paragraph', 'text': 'Contenido completo en español.'},
        ],
      };
      final old = {
        ...metadata,
        'id': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'titleEs': 'Noticia guardada anteriormente',
      };
      SharedPreferences.setMockInitialValues({
        'saved': jsonEncode([old]),
        'summaryEndpoint': defaultAndesEndpoint,
      });
      FlutterSecureStorage.setMockInitialValues({'andesApiToken': 'x' * 32});
      final requests = <http.Request>[];
      final client = MockClient((request) async {
        requests.add(request);
        if (request.url.path == '/articles/$id') {
          return http.Response(
            jsonEncode({'article': detail}),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response(
          jsonEncode({
            'articles': [metadata],
            'collection': {'errors': {}},
            'counts': {'ready': 1},
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      addTearDown(client.close);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            newsServiceProvider.overrideWithValue(NewsService(client: client)),
          ],
          child: const AndesApp(),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Python mejora su API'), findsOneWidget);
      await tester.tap(find.text('Python mejora su API'));
      await tester.pumpAndSettle();
      expect(find.text('Una API para desarrolladores.'), findsOneWidget);
      await tester.tap(find.text('Artículo limpio'));
      await tester.pumpAndSettle();
      expect(find.text('Contenido completo en español.'), findsOneWidget);
      await tester.tap(find.text('Original'));
      await tester.pumpAndSettle();
      expect(find.text('Original article body.'), findsOneWidget);
      await tester.tap(find.byTooltip('Guardar noticia'));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Guardados'));
      await tester.pumpAndSettle();
      final stored = await SharedPreferences.getInstance();
      expect(
        stored.getString('saved'),
        contains('Noticia guardada anteriormente'),
      );
      await tester.scrollUntilVisible(
        find.text('Python mejora su API'),
        200,
        scrollable: find
            .descendant(
              of: find.byType(CustomScrollView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(find.text('Python mejora su API'), findsOneWidget);
      await tester.tap(find.text('Ajustes'));
      await tester.pumpAndSettle();
      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), 'https://new.example.com');
      await tester.enterText(fields.at(1), 'y' * 32);
      await tester.ensureVisible(find.text('Guardar conexión'));
      await tester.tap(find.text('Guardar conexión'));
      await tester.pumpAndSettle();
      expect(requests.last.url.host, 'new.example.com');
      expect(requests.last.headers['Authorization'], 'Bearer ${'y' * 32}');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('andesEndpoint'), 'https://new.example.com');
      expect(prefs.getString('saved'), contains('Original article body.'));
      expect(
        prefs.getString('article:v3:$id'),
        contains('Original article body.'),
      );
      expect(
        await const FlutterSecureStorage().read(key: 'andesApiToken'),
        'y' * 32,
      );
      final hackerNews = find.widgetWithText(SwitchListTile, 'Hacker News');
      await tester.scrollUntilVisible(
        hackerNews,
        200,
        scrollable: find
            .descendant(
              of: find.byType(ListView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.ensureVisible(hackerNews);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      await tester.tap(hackerNews);
      await tester.pumpAndSettle();
      expect(prefs.getStringList('sources'), isNot(contains('hn')));
      await tester.tap(find.text('Guardados'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Python mejora su API'),
        200,
        scrollable: find
            .descendant(
              of: find.byType(CustomScrollView),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      expect(find.text('Python mejora su API'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
