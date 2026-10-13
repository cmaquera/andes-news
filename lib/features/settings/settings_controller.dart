import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/network/news_service.dart';
import '../../data/repositories/settings_repository.dart';

class SettingsState {
  final ConnectionSettings value;
  final bool loading, saving;
  final String? error;
  SettingsState({
    ConnectionSettings? value,
    this.loading = true,
    this.saving = false,
    this.error,
  }) : value = value ?? ConnectionSettings();
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
      if (ref.mounted) state = SettingsState(value: value, loading: false);
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
    if (token.length < 32) {
      return 'Introduce el token de acceso configurado en el servidor.';
    }
    return _save(state.value.copyWith(endpoint: endpoint, token: token));
  }

  Future<String?> setSource(String id, bool enabled) async {
    final selected = {...state.value.enabledSources};
    if (enabled) {
      selected.add(id);
    } else {
      selected.remove(id);
    }
    return _save(state.value.copyWith(enabledSources: selected));
  }

  Future<String?> _save(ConnectionSettings value) async {
    if (state.saving) return 'Ya hay una configuración guardándose.';
    state = SettingsState(value: state.value, loading: false, saving: true);
    try {
      await ref.read(settingsRepositoryProvider).save(value);
      if (ref.mounted) state = SettingsState(value: value, loading: false);
      return null;
    } catch (_) {
      const error = 'No se pudo guardar la configuración en el teléfono.';
      if (ref.mounted) {
        state = SettingsState(value: state.value, loading: false, error: error);
      }
      return error;
    }
  }
}
