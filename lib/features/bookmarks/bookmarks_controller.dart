import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../data/models/article.dart';
import '../settings/settings_controller.dart';

class BookmarksState {
  final Map<String, Article> articles;
  final bool loading;
  final String? error;
  BookmarksState({
    Map<String, Article> articles = const {},
    this.loading = true,
    this.error,
  }) : articles = Map.unmodifiable(articles);
}

final bookmarksProvider = NotifierProvider<BookmarksController, BookmarksState>(
  BookmarksController.new,
);

class BookmarksController extends Notifier<BookmarksState> {
  Future<void>? _initialization;
  Future<void> _writes = Future.value();
  @override
  BookmarksState build() => BookmarksState();
  Future<void> initialize() => _initialization ??= _load();
  Future<void> _load() async {
    try {
      final articles = await ref.read(bookmarksRepositoryProvider).read();
      if (ref.mounted) {
        state = BookmarksState(
          articles: {for (final a in articles) a.id: a},
          loading: false,
        );
      }
    } catch (_) {
      if (ref.mounted) {
        state = BookmarksState(
          articles: state.articles,
          loading: false,
          error: 'No se pudieron cargar los guardados.',
        );
      }
    }
  }

  Future<String?> toggle(Article article) async {
    await initialize();
    if (!ref.mounted) return null;
    final old = state.articles, remove = old.containsKey(article.id);
    // Commit the toggle before downloading its body so a double tap cannot
    // accidentally recreate a removed bookmark when an old request completes.
    final next = {...old};
    if (remove) {
      next.remove(article.id);
    } else {
      next[article.id] = article;
    }
    state = BookmarksState(articles: next, loading: false);
    await _persist();
    if (!ref.mounted) return null;
    if (remove || article.content.isNotEmpty) {
      return state.error;
    }
    final repo = ref.read(newsRepositoryProvider),
        settings = ref.read(settingsProvider).value;
    try {
      final snapshot =
          await repo.cachedArticle(article.id) ??
          await repo.fetchArticle(article.id, settings);
      if (ref.mounted && identical(state.articles[article.id], article)) {
        state = BookmarksState(
          articles: {...state.articles, article.id: snapshot},
          loading: false,
        );
        await _persist();
      }
      return ref.mounted ? state.error : null;
    } catch (_) {
      return 'Noticia guardada. Abre la lectura con conexión para descargar su contenido.';
    }
  }

  Future<void> _persist() async {
    final repo = ref.read(bookmarksRepositoryProvider),
        snapshot = state.articles.values.toList();
    final write = _writes.then((_) => repo.save(snapshot));
    _writes = write.catchError((_) {});
    try {
      await write;
    } catch (_) {
      if (ref.mounted) {
        state = BookmarksState(
          articles: state.articles,
          loading: false,
          error: 'No se pudo guardar el cambio en el teléfono.',
        );
      }
    }
  }
}
