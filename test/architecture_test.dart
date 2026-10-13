import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:andes_news/app/providers.dart';
import 'package:andes_news/core/network/news_service.dart';
import 'package:andes_news/core/storage/local_store.dart';
import 'package:andes_news/core/errors/feed_exception.dart';
import 'package:andes_news/data/models/article.dart';
import 'package:andes_news/data/repositories/news_repository.dart';
import 'package:andes_news/data/repositories/settings_repository.dart';
import 'package:andes_news/features/feed/feed_controller.dart';
import 'package:andes_news/features/bookmarks/bookmarks_controller.dart';
import 'package:andes_news/features/settings/settings_controller.dart';
import 'package:andes_news/features/reader/reader_controller.dart';

final story = Article(
  id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  title: 'Python API',
  url: 'https://example.com/a',
  sourceId: 'hn',
  region: 'Global',
  topic: 'Programación',
);
Article fullStory(String title) => Article.fromJson({
  ...story.toJson(),
  'title': title,
  'content': [
    {'type': 'paragraph', 'text': 'Texto guardado completo'},
  ],
});

class MemorySettings implements SettingsRepository {
  ConnectionSettings value = ConnectionSettings(token: 'x' * 32);
  @override
  Future<ConnectionSettings> read() async => value;
  @override
  Future<void> save(ConnectionSettings next) async {
    value = next;
  }
}

class DeferredNews implements NewsRepository {
  List<Article> cache = [story];
  final calls = <Completer<FeedResult>>[];
  final detail = Completer<Article>();
  Article? savedArticle;
  bool failDetail = false;
  @override
  Future<List<Article>> cachedFeed() async => cache;
  @override
  Future<DateTime?> lastUpdate() async => null;
  @override
  Future<void> cacheFeed(List<Article> articles, DateTime? updated) async {
    cache = articles;
  }

  @override
  Future<FeedResult> fetchFeed(ConnectionSettings settings) {
    final call = Completer<FeedResult>();
    calls.add(call);
    return call.future;
  }

  @override
  Future<Article?> cachedArticle(String id) async => savedArticle;
  @override
  Future<Article> fetchArticle(String id, ConnectionSettings settings) {
    if (failDetail) {
      throw const FeedException(
        'Noticia no disponible',
        kind: FeedFailureKind.notFound,
      );
    }
    return detail.future;
  }

  @override
  Future<void> cacheArticle(Article article) async {
    savedArticle = article;
  }
}

Future<void> until(bool Function() condition) async {
  for (int i = 0; i < 30 && !condition(); i++) {
    await Future<void>.delayed(Duration.zero);
  }
  expect(condition(), true);
}

void main() {
  test('Article and table collections are defensive immutable snapshots', () {
    final cells = [const TableCellData('Original')], rows = [cells];
    final block = ContentBlock('table', '', rows: rows);
    cells.clear();
    rows.clear();
    expect(block.rows.single.single.text, 'Original');
    expect(() => block.rows.clear(), throwsUnsupportedError);
    expect(() => block.rows.single.clear(), throwsUnsupportedError);
    final content = [block], keys = ['Un hecho'];
    final article = Article(
      id: story.id,
      title: story.title,
      url: story.url,
      sourceId: story.sourceId,
      region: story.region,
      topic: story.topic,
      content: content,
      keyPoints: keys,
    );
    content.clear();
    keys.clear();
    expect(article.content.length, 1);
    expect(article.keyPoints, ['Un hecho']);
    expect(() => article.content.clear(), throwsUnsupportedError);
  });
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
  });
  test('Corrupt feed cannot discard bookmarks; malformed entries recover independently', () async {
    SharedPreferences.setMockInitialValues({
      'feed': 'broken-json',
      'saved': jsonEncode([
        story.toJson(),
        {'bad': 'entry'},
      ]),
      'article:v3:${story.id}': 'broken-json',
    });
    final local = LocalStore();
    expect(await local.readArticles('feed'), isEmpty);
    expect((await local.readArticles('saved')).single.id, story.id);
    expect(await local.readArticle(story.id), isNull);
  });
  test(
    'Legacy URL, secure token, bookmarks and reader cache survive upgrade',
    () async {
      SharedPreferences.setMockInitialValues({
        'summaryEndpoint': 'https://old.example.com',
        'sources': ['hn'],
        'saved': jsonEncode([story.toJson()]),
        'article:v3:${story.id}': jsonEncode(fullStory('Original').toJson()),
      });
      FlutterSecureStorage.setMockInitialValues({'andesApiToken': 'z' * 32});
      final local = LocalStore(), repo = DeviceSettingsRepository(local);
      final value = await repo.read();
      expect(value.endpoint, 'https://old.example.com');
      expect(value.token, 'z' * 32);
      expect(value.enabledSources, {'hn'});
      await repo.save(value);
      expect(
        (await local.preferences).getString('andesEndpoint'),
        value.endpoint,
      );
      expect((await local.readArticles('saved')).length, 1);
      expect(
        (await local.readArticle(story.id))!.content.single.text,
        'Texto guardado completo',
      );
    },
  );
  test('Repeated refresh shares a request; changed credentials invalidate stale results and cache', () async {
    final repo = DeferredNews(), settings = MemorySettings();
    final container = ProviderContainer(
      overrides: [
        newsRepositoryProvider.overrideWithValue(repo),
        settingsRepositoryProvider.overrideWithValue(settings),
      ],
    );
    addTearDown(container.dispose);
    final controller = container.read(feedProvider.notifier),
        initial = controller.initialize();
    await until(() => repo.calls.length == 1);
    final shared = controller.refresh();
    expect(repo.calls.length, 1);
    await container
        .read(settingsProvider.notifier)
        .saveConnection('https://new.example.com', 'y' * 32);
    final next = controller.refresh();
    expect(repo.calls.length, 2);
    repo.calls[1].complete(FeedResult([fullStory('Nueva respuesta')], {}));
    await next;
    repo.calls[0].complete(FeedResult([fullStory('Respuesta antigua')], {}));
    await initial;
    await shared;
    expect(
      container.read(feedProvider).articles.single.title,
      'Nueva respuesta',
    );
    expect(repo.cache.single.title, 'Nueva respuesta');
    expect(
      () => container.read(feedProvider).articles.clear(),
      throwsUnsupportedError,
    );
  });
  test('An offline refresh retains the cache and reports its error', () async {
    final repo = DeferredNews(),
        container = ProviderContainer(
          overrides: [
            newsRepositoryProvider.overrideWithValue(repo),
            settingsRepositoryProvider.overrideWithValue(MemorySettings()),
          ],
        );
    addTearDown(container.dispose);
    final initial = container.read(feedProvider.notifier).initialize();
    await until(() => repo.calls.isNotEmpty);
    repo.calls.single.complete(FeedResult([], {}, error: 'Sin conexión'));
    await initial;
    expect(container.read(feedProvider).articles.single.id, story.id);
    expect(container.read(feedProvider).error, 'Sin conexión');
    expect(container.read(feedProvider).loading, false);
  });
  test(
    'Removing a bookmark during body download cannot restore it later',
    () async {
      final repo = DeferredNews(),
          container = ProviderContainer(
            overrides: [
              newsRepositoryProvider.overrideWithValue(repo),
              settingsRepositoryProvider.overrideWithValue(MemorySettings()),
            ],
          );
      addTearDown(container.dispose);
      final ctrl = container.read(bookmarksProvider.notifier);
      await container.read(settingsProvider.notifier).initialize();
      final save = ctrl.toggle(story);
      await until(
        () => container.read(bookmarksProvider).articles.containsKey(story.id),
      );
      await ctrl.toggle(story);
      repo.detail.complete(fullStory('Completa'));
      await save;
      expect(container.read(bookmarksProvider).articles, isEmpty);
      expect(await LocalStore().readArticles('saved'), isEmpty);
    },
  );
  test(
    'Reader retains full cached article when original disappears from API',
    () async {
      final repo = DeferredNews()
        ..savedArticle = fullStory('Copia local')
        ..failDetail = true;
      final container = ProviderContainer(
        overrides: [
          newsRepositoryProvider.overrideWithValue(repo),
          settingsRepositoryProvider.overrideWithValue(MemorySettings()),
        ],
      );
      addTearDown(container.dispose);
      final subscription = container.listen(readerProvider(story), (_, _) {});
      addTearDown(subscription.close);
      await container.read(settingsProvider.notifier).initialize();
      await container.read(readerProvider(story).notifier).initialize();
      expect(
        container.read(readerProvider(story)).article.title,
        'Copia local',
      );
      expect(
        container.read(readerProvider(story)).error,
        'Noticia no disponible',
      );
    },
  );
  test('404 article and incompatible API are distinct errors; caller owns injected HTTP client', () async {
    final client = MockClient((_) async => http.Response('{}', 404));
    final service = NewsService(client: client, token: 'x' * 32);
    await expectLater(
      service.detail(story.id),
      throwsA(
        isA<FeedException>().having(
          (e) => e.kind,
          'kind',
          FeedFailureKind.notFound,
        ),
      ),
    );
    await expectLater(
      service.getJson('/articles'),
      throwsA(
        isA<FeedException>().having(
          (e) => e.kind,
          'kind',
          FeedFailureKind.incompatible,
        ),
      ),
    );
    service.close();
    expect(
      (await client.get(Uri.parse('https://example.com'))).statusCode,
      404,
    );
    client.close();
  });
}
