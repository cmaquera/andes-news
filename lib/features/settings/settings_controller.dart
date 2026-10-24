import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/network/news_service.dart';
import '../../data/models/article.dart';
import '../../data/repositories/settings_repository.dart';

class SettingsState {
  final ConnectionSettings value;
  final List<NewsSource> sources;
  final bool loading, saving;
  final String? error;
  SettingsState({
    ConnectionSettings? value,
    List<NewsSource>? sources,
    this.loading = true,
    this.saving = false,
    this.error,
  }) : value = value ?? ConnectionSettings(),
       sources = List.unmodifiable(sources ?? defaultSources);
}

final settingsProvider = NotifierProvider<SettingsController, SettingsState>(
  SettingsController.new,
);

class SettingsController extends Notifier<SettingsState> {
  Future<void>? _initialization;
  @override
  SettingsState build() => SettingsState();
  Future<void> initialize() => _initialization ??= _load();
  Future<void> _load() async {
    try {
      final value = await ref.read(settingsRepositoryProvider).read();
      final newsRepo = ref.read(newsRepositoryProvider);
      final cachedSources = await newsRepo.cachedSources();
      if (ref.mounted) {
        state = SettingsState(
          value: value,
          sources: cachedSources,
          loading: false,
        );
      }
      try {
        final fresh = await newsRepo.fetchSources(value);
        if (ref.mounted && fresh.isNotEmpty) {
          state = SettingsState(
            value: state.value,
            sources: fresh,
            loading: false,
          );
        }
      } catch (_) {}
    } catch (_) {
      if (ref.mounted) {
        state = SettingsState(
          value: state.value,
          loading: false,
          error:
              'No se pudo recuperar la configuración o el token del teléfono.',
        );
      }
    }
  }

  Future<String?> saveConnection(String endpoint, String token) async {
    endpoint = endpoint.trim();
    token = token.trim();
    if (!validAndesEndpoint(endpoint)) {
      return 'Usa una URL HTTPS válida del servicio de Andes.';
    }
    final next = state.value.copyWith(endpoint: endpoint, token: token);
    final error = await _save(next);
    if (error == null) {
      try {
        final fresh = await ref.read(newsRepositoryProvider).fetchSources(next);
        if (ref.mounted && fresh.isNotEmpty) {
          state = SettingsState(
            value: state.value,
            sources: fresh,
            loading: false,
          );
        }
      } catch (_) {}
    }
    return error;
  }

  Future<String?> setSource(String id, bool enabled) async {
    final disabled = {...state.value.disabledSources};
    final legacy = state.value.enabledSources.isNotEmpty
        ? {...state.value.enabledSources}
        : null;
    if (enabled) {
      disabled.remove(id);
      if (id == 'hackernews') {
        disabled.remove('hn');
        legacy?.add('hn');
      }
      if (id == 'hn') {
        disabled.remove('hackernews');
        legacy?.add('hackernews');
      }
      legacy?.add(id);
    } else {
      disabled.add(id);
      if (id == 'hackernews') {
        disabled.add('hn');
        legacy?.remove('hn');
      }
      if (id == 'hn') {
        disabled.add('hackernews');
        legacy?.remove('hackernews');
      }
      legacy?.remove(id);
    }
    return _save(
      state.value.copyWith(disabledSources: disabled, enabledSources: legacy),
    );
  }

  Future<String?> _save(ConnectionSettings value) async {
    if (state.saving) return 'Ya hay una configuración guardándose.';
    state = SettingsState(
      value: state.value,
      sources: state.sources,
      loading: false,
      saving: true,
    );
    try {
      await ref.read(settingsRepositoryProvider).save(value);
      if (ref.mounted) {
        state = SettingsState(
          value: value,
          sources: state.sources,
          loading: false,
        );
      }
      return null;
    } catch (_) {
      const error = 'No se pudo guardar la configuración en el teléfono.';
      if (ref.mounted) {
        state = SettingsState(
          value: state.value,
          sources: state.sources,
          loading: false,
          error: error,
        );
      }
      return error;
    }
  }
}
