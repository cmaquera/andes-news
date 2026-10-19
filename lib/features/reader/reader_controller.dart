import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/errors/feed_exception.dart';
import '../../data/models/article.dart';
import '../settings/settings_controller.dart';

class ReaderState {
  final Article article;
  final bool loading;
  final String error;
  const ReaderState(this.article, {this.loading = false, this.error = ''});
}

final readerProvider = NotifierProvider.autoDispose
    .family<ReaderController, ReaderState, Article>(ReaderController.new);

class ReaderController extends Notifier<ReaderState> {
  final Article initial;
  ReaderController(this.initial);
  int _generation = 0;
  Timer? _documentTimer;
  int _documentPolls = 0;
  @override
  ReaderState build() {
    ref.onDispose(() => _documentTimer?.cancel());
    return ReaderState(initial);
  }

  Future<void> initialize() async {
    final generation = ++_generation;
    final cached = await ref
        .read(newsRepositoryProvider)
        .cachedArticle(initial.id);
    if (!ref.mounted || generation != _generation) return;
    if (cached != null) state = ReaderState(cached);
    await refresh();
  }

  Future<void> refresh({bool documentPoll = false}) async {
    _documentTimer?.cancel();
    if (!documentPoll) _documentPolls = 0;
    final generation = ++_generation,
        repo = ref.read(newsRepositoryProvider),
        settings = ref.read(settingsProvider).value;
    state = ReaderState(state.article, loading: !documentPoll);
    try {
      final article = await repo.fetchArticle(initial.id, settings);
      if (!ref.mounted || generation != _generation) return;
      state = ReaderState(article);
      await repo.cacheArticle(article);
      if (ref.mounted &&
          generation == _generation &&
          article.documentDiscovery == 'pending' &&
          _documentPolls < 10) {
        _documentPolls++;
        _documentTimer = Timer(
          const Duration(seconds: 2),
          () => unawaited(refresh(documentPoll: true)),
        );
      }
    } catch (e) {
      if (ref.mounted && generation == _generation) {
        state = ReaderState(
          state.article,
          error: e is FeedException
              ? e.message
              : 'No se pudo actualizar. Puedes leer el contenido guardado.',
        );
      }
    }
  }
}
