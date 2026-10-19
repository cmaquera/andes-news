import 'dart:convert';

import 'package:flutter/material.dart';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:andes_news/app/providers.dart';
import 'package:andes_news/core/network/news_service.dart';
import 'package:andes_news/core/storage/local_store.dart';
import 'package:andes_news/data/models/article.dart';
import 'package:andes_news/data/repositories/news_repository.dart';
import 'package:andes_news/data/repositories/settings_repository.dart';
import 'package:andes_news/features/settings/settings_controller.dart';
import 'package:andes_news/features/reader/reader_screen.dart';

class NativeFixtureService extends NewsService {
  final Article article;
  NativeFixtureService(this.article);
  @override
  Future<Article> detail(String id) async => article;
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });
  testWidgets(
    'Native reader shows editorial reason and publication label on a narrow screen',
    (tester) async {
      final article = Article(
        id: 'b' * 32,
        title: 'Python release',
        url: 'https://example.com/release',
        sourceId: 'horizon:github:abc',
        sourceLabel: 'Python releases',
        region: 'Global',
        topic: 'Programación',
        contentKind: 'release',
        editorialScore: 9.5,
        editorialStatus: 'accepted',
        selectionReasons: ['Contenido técnico concreto'],
        status: 'ready',
        content: [ContentBlock('paragraph', 'Texto nativo de la publicación')],
      );
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            newsServiceProvider.overrideWithValue(
              NativeFixtureService(article),
            ),
          ],
          child: MaterialApp(home: ArticleScreen(article: article)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Publicación original'), findsOneWidget);
      expect(find.text('Valor editorial: 9.5/10'), findsOneWidget);
      expect(find.text('Contenido técnico concreto'), findsOneWidget);
      await tester.tap(find.text('Publicación'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Texto nativo de la publicación'),
        150,
      scrollable: find.byType(Scrollable).first,
      );
      expect(find.text('Texto nativo de la publicación'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  test(
    'Remote source, score and native provenance survive API and offline cache',
    () async {
      const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      final raw = {
        'id': id,
        'title': 'Python release',
        'url': 'https://example.com/release',
        'sourceId': 'horizon:github:abc',
        'sourceName': 'Python releases',
        'region': 'Global',
        'topic': 'Programación',
        'contentKind': 'release',
        'score': 123,
        'editorialScore': 9.5,
        'editorialStatus': 'accepted',
        'selectionReasons': ['Contenido técnico concreto'],
        'sourceOccurrences': [
          {
            'sourceName': 'Python releases',
            'sourceUrl': 'https://example.com/release',
          },
        ],
      };
      final service = NewsService(
        token: 'x' * 32,
        client: MockClient((request) async {
          return http.Response(
            jsonEncode(
              request.url.path == '/sources'
                  ? {
                      'sources': [
                        {
                          'id': 'horizon:github:abc',
                          'name': 'Python releases',
                          'region': 'Global',
                        },
                      ],
                    }
                  : {
                      'articles': [raw],
                      'collection': {},
                      'counts': {},
                    },
            ),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final local = LocalStore();
      final repo = ApiNewsRepository(service, local);
      final result = await repo.fetchFeed(ConnectionSettings(token: 'x' * 32));
      expect(result.catalog.single.id, 'horizon:github:abc');
      final article = result.articles.single;
      expect(article.sourceName, 'Python releases');
      expect(article.isNative, true);
      expect(article.score, 123);
      expect(article.editorialScore, 9.5);
      await local.writeArticle(article);
      final cached = (await local.readArticle(id))!;
      expect(cached.selectionReasons, ['Contenido técnico concreto']);
      expect(cached.sourceOccurrences.single['sourceName'], 'Python releases');
    },
  );
  test('Catalog merge enables new sources and preserves disabled old sources on restart', () async {
    final local = LocalStore();
    final repo = DeviceSettingsRepository(local);
    await repo.save(
      ConnectionSettings(token: 'x' * 32, enabledSources: {'hn'}),
    );
    final container = ProviderContainer(
      overrides: [settingsRepositoryProvider.overrideWithValue(repo)],
    );
    addTearDown(container.dispose);
    final controller = container.read(settingsProvider.notifier);
    await controller.initialize();
    await controller.mergeCatalog([
      ...sources,
      const NewsSource('horizon:telegram:abc', 'Canal técnico', 'Global'),
    ]);
    final saved = await repo.read();
    expect(saved.enabledSources, {'hn', 'horizon:telegram:abc'});
    expect(saved.catalog.last.name, 'Canal técnico');
    await controller.setSource('horizon:telegram:abc', false);
    await controller.mergeCatalog(saved.catalog);
    expect((await repo.read()).enabledSources, {'hn'});
  });
}
