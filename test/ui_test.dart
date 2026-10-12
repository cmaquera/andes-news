import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:andes_news/main.dart';
import 'package:andes_news/news.dart';

const fixture = Article(
  id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  title: 'Original article title',
  titleEs: 'Titular en español',
  url: 'https://example.com/a',
  sourceId: 'hn',
  region: 'Global',
  topic: 'Programación',
  abstract: 'El abstracto se preparó con el texto del artículo.',
  status: 'ready',
  coverage: 'extracted',
  wordCount: 350,
  language: 'en',
  content: [
    ContentBlock('paragraph', 'Original clean article body.'),
    ContentBlock('code', 'print("hello")'),
  ],
  translatedContent: [
    ContentBlock('paragraph', 'Cuerpo del artículo traducido completo.'),
    ContentBlock('code', 'print("hello")'),
  ],
);

class FixtureService extends NewsService {
  @override
  Future<FeedResult> load(Set<String> enabled) async =>
      FeedResult([fixture], {});
  @override
  Future<Article> detail(String id) async => fixture;
}

void main() {
  testWidgets(
    'Prepared abstract and full clean reader work without browser or model call',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: andesTheme(),
          home: ArticleScreen(
            article: fixture,
            endpoint: defaultAndesEndpoint,
            token: 'x' * 32,
            prefs: prefs,
            isSaved: false,
            onSave: (_) async {},
            service: FixtureService(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text(fixture.abstract), findsOneWidget);
      expect(find.text('Resumir en español'), findsNothing);
      await tester.tap(find.text('Artículo limpio'));
      await tester.pumpAndSettle();
      expect(
        find.text('Cuerpo del artículo traducido completo.'),
        findsOneWidget,
      );
      expect(find.text('print("hello")'), findsOneWidget);
      await tester.tap(find.text('Original'));
      await tester.pumpAndSettle();
      expect(find.text('Original clean article body.'), findsOneWidget);
      expect(
        prefs.getString('article:v3:${fixture.id}'),
        contains('Original clean article body'),
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'Feed bookmarks prepared articles and settings configure backend',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: andesTheme(),
          home: FeedScreen(service: FixtureService()),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Titular en español'), findsOneWidget);
      await tester.tap(find.byTooltip('Guardar noticia'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Guardados'));
      await tester.pumpAndSettle();
      expect(find.text('Titular en español'), findsOneWidget);
      await tester.tap(find.text('Ajustes'));
      await tester.pumpAndSettle();
      expect(find.text('Tu espacio'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
