import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../data/models/article.dart';
import '../../data/repositories/settings_repository.dart';
import '../settings/settings_controller.dart';
import '../bookmarks/bookmarks_controller.dart';

class FeedState {
  final List<Article> articles;
  final List<NewsSource> sources;
  final Map<String, String> sourceErrors;
  final Map<String, dynamic> counts;
  final String? error;
  final bool loading;
  final DateTime? updated;
  FeedState({
    List<Article> articles = const [],
    List<NewsSource> sources = const [],
    Map<String, String> sourceErrors = const {},
    Map<String, dynamic> counts = const {},
    this.error,
    this.loading = true,
    this.updated,
  }) : articles = List.unmodifiable(articles),
       sources = List.unmodifiable(
         sources.isNotEmpty ? sources : defaultSources,
       ),
       sourceErrors = Map.unmodifiable(sourceErrors),
       counts = Map.unmodifiable(counts);
}

final feedProvider = NotifierProvider<FeedController, FeedState>(
  FeedController.new,
);

class FeedController extends Notifier<FeedState> {
  Future<void>? _initialization, _pending;
  ConnectionSettings? _activeSettings;
  int _generation = 0;
  Future<void> _cacheWrites = Future.value();
  @override
  FeedState build() => FeedState();
  Future<void> initialize() => _initialization ??= _load();
  Future<void> _load() async {
    final repo = ref.read(newsRepositoryProvider);
    await Future.wait([
      ref.read(settingsProvider.notifier).initialize(),
      ref.read(bookmarksProvider.notifier).initialize(),
    ]);
    try {
      final cached = await repo.cachedFeed(),
          updated = await repo.lastUpdate(),
          cachedSources = await repo.cachedSources();
      if (!ref.mounted) return;
      state = FeedState(
        articles: cached,
        updated: updated,
        sources: cachedSources,
      );
    } catch (_) {
      if (!ref.mounted) return;
      state = FeedState(
        articles: state.articles,
        sources: state.sources,
        error: 'No se pudo recuperar la caché del teléfono.',
      );
    }
    await refresh();
  }

  Future<void> refresh() {
    final settings = ref.read(settingsProvider).value;
    if (_pending != null &&
        _activeSettings?.endpoint == settings.endpoint &&
        _activeSettings?.token == settings.token) {
      return _pending!;
    }
    _activeSettings = settings;
    final generation = ++_generation;
    state = FeedState(
      articles: state.articles,
      sources: state.sources,
      updated: state.updated,
      sourceErrors: state.sourceErrors,
      counts: state.counts,
    );
    final task = _fetch(settings, generation);
    _pending = task;
    return task.whenComplete(() {
      if (generation == _generation) _pending = null;
    });
  }

  Future<void> _fetch(ConnectionSettings settings, int generation) async {
    final repo = ref.read(newsRepositoryProvider);
    try {
      final result = await repo.fetchFeed(settings);
      List<NewsSource> freshSources = state.sources;
      try {
        freshSources = await repo.fetchSources(settings);
      } catch (_) {}
      if (!ref.mounted || generation != _generation) return;
      final articles = result.error == null ? result.articles : state.articles,
          updated = result.collectedAt ?? state.updated;
      state = FeedState(
        articles: articles,
        sources: freshSources,
        updated: updated,
        sourceErrors: result.errors,
        counts: result.counts,
        error: result.error,
        loading: false,
      );
      if (result.error == null) {
        final write = _cacheWrites.then((_) async {
          if (ref.mounted && generation == _generation) {
            await repo.cacheFeed(articles, updated);
          }
        });
        _cacheWrites = write.catchError((_) {});
        try {
          await write;
        } catch (_) {
          if (ref.mounted && generation == _generation) {
            state = FeedState(
              articles: state.articles,
              sources: state.sources,
              updated: updated,
              sourceErrors: state.sourceErrors,
              counts: state.counts,
              loading: false,
              error: 'Noticias cargadas, pero no se pudo actualizar la caché del teléfono.',
            );
          }
        }
      }
    } catch (_) {
      if (!ref.mounted || generation != _generation) return;
      state = FeedState(
        articles: state.articles,
        sources: state.sources,
        updated: state.updated,
        loading: false,
        error: 'No se pudo actualizar. Conservamos la última carga.',
      );
    }
  }
}

List<Article> filterArticles(
  Iterable<Article> articles, {
  Set<String>? enabled,
  ConnectionSettings? settings,
  String region = 'Todas',
  String topic = 'Todo',
  String source = '',
  String query = '',
}) => articles
    .where(
      (a) =>
          (settings != null
              ? settings.isSourceEnabled(a.sourceId)
              : (enabled == null || enabled.contains(a.sourceId))) &&
          (region == 'Todas' ||
              a.region == region ||
              (region == 'Latinoamérica' && a.region == 'Perú')) &&
          (topic == 'Todo' || a.topic == topic) &&
          (source.isEmpty || a.sourceId == source) &&
          '${a.displayTitle} ${a.title} ${a.excerpt} ${a.sourceName}'
              .toLowerCase()
              .contains(query.toLowerCase()),
    )
    .toList(growable: false);
