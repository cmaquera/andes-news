import '../../core/network/news_service.dart';
import '../../core/storage/local_store.dart';
import '../models/article.dart';
import 'settings_repository.dart';

abstract interface class NewsRepository {
  Future<List<Article>> cachedFeed();
  Future<void> cacheFeed(List<Article> articles, DateTime? updated);
  Future<DateTime?> lastUpdate();
  Future<FeedResult> fetchFeed(ConnectionSettings settings);
  Future<Article?> cachedArticle(String id);
  Future<Article> fetchArticle(String id, ConnectionSettings settings);
  Future<void> cacheArticle(Article article);
}

class ApiNewsRepository implements NewsRepository {
  final NewsService service;
  final LocalStore local;
  ApiNewsRepository(this.service, this.local);
  @override
  Future<List<Article>> cachedFeed() => local.readArticles('feed');
  @override
  Future<void> cacheFeed(List<Article> articles, DateTime? updated) async {
    await local.writeArticles('feed', articles);
    if (updated != null) {
      await (await local.preferences).setString(
        'updated',
        updated.toIso8601String(),
      );
    }
  }

  @override
  Future<DateTime?> lastUpdate() async =>
      DateTime.tryParse((await local.preferences).getString('updated') ?? '');
  @override
  Future<FeedResult> fetchFeed(ConnectionSettings settings) async {
    service.configure(settings.endpoint, settings.token);
    // Store the complete feed; source switches filter locally without losing
    // cached stories from temporarily disabled sources.
    List<NewsSource> catalog = const [];
    try {
      catalog = await service.catalog();
    } catch (_) {
      /* Cached sources remain usable offline or on older servers. */
    }
    final result = await service.load({
      ...sources.map((s) => s.id),
      ...settings.catalog.map((s) => s.id),
      ...catalog.map((s) => s.id),
    });
    return FeedResult(
      result.articles,
      result.errors,
      error: result.error,
      collectedAt: result.collectedAt,
      counts: result.counts,
      catalog: catalog,
    );
  }

  @override
  Future<Article?> cachedArticle(String id) => local.readArticle(id);
  @override
  Future<Article> fetchArticle(String id, ConnectionSettings settings) {
    service.configure(settings.endpoint, settings.token);
    return service.detail(id);
  }

  @override
  Future<void> cacheArticle(Article article) => local.writeArticle(article);
}
