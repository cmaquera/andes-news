import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:andes_news/main.dart';
import 'package:andes_news/news.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:andes_news/summary.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'dart:convert';

class FixtureService extends NewsService {
  @override
  Future<FeedResult> load(Set<String> enabled) async => FeedResult([
    Article(
      id: 'preview',
      title: 'Una nueva versión de Python para tu próximo proyecto',
      url: 'https://example.com/demo',
      excerpt: 'Contenido de ejemplo para verificar la interfaz de lectura.',
      sourceId: 'gestion',
      region: 'Perú',
      topic: 'Programación',
      published: DateTime.utc(2026, 10, 12, 12),
    ),
  ], {});
}

void main() {
  testWidgets('Translated title and summary are displayed and cached', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final article = (await FixtureService().load({})).articles.single;
    await tester.pumpWidget(
      MaterialApp(
        theme: andesTheme(),
        home: ArticleScreen(
          article: article,
          endpoint: 'https://api.example.com',
          token: 'x' * 32,
          prefs: prefs,
          isSaved: false,
          onSave: () async {},
          service: SummaryService(
            client: MockClient(
              (r) async => http.Response(
                jsonEncode({
                  'titleEs': 'Titular traducido de prueba',
                  'summary': 'Resumen traducido de prueba. Conserva la información original.',
                  'basis': 'excerpt',
                }),
                200,
                headers: {'content-type': 'application/json; charset=utf-8'},
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Resumir en español'), 120);
    await tester.drag(find.byType(ListView), const Offset(0, -300));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Resumir en español'));
    await tester.pumpAndSettle();
    expect(
      prefs.getString(summaryKey(article)),
      contains('Titular traducido de prueba'),
    );
    await tester.scrollUntilVisible(
      find.text(
        'Resumen traducido de prueba. Conserva la información original.',
      ),
      -120,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.text(
        'Resumen traducido de prueba. Conserva la información original.',
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'Small screen supports bookmarking, detail and sources without overflow',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(
            useMaterial3: true,
            colorScheme: ColorScheme.fromSeed(seedColor: green),
          ),
          home: FeedScreen(service: FixtureService()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('1 lecturas'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byTooltip('Guardar noticia'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Guardados'));
      await tester.pumpAndSettle();
      expect(
        find.text('Una nueva versión de Python para tu próximo proyecto'),
        findsOneWidget,
      );
      await tester.tap(
        find.text('Una nueva versión de Python para tu próximo proyecto'),
      );
      await tester.pumpAndSettle();
      expect(find.text('En pocas palabras'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Resumir en español'), 120);
      await tester.tap(find.text('Resumir en español'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Configura el servicio'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ajustes'));
      await tester.pumpAndSettle();
      expect(find.text('Tu espacio'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
