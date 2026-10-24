import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/storage/local_store.dart';
import '../models/article.dart';

class ConnectionSettings {
  final String endpoint, token;
  final Set<String> disabledSources;
  final Set<String>? _legacyEnabled;

  ConnectionSettings({
    this.endpoint = defaultAndesEndpoint,
    this.token = '',
    Set<String>? disabledSources,
    Set<String>? enabledSources,
  }) : disabledSources = Set.unmodifiable(disabledSources ?? const <String>{}),
       _legacyEnabled = enabledSources != null
           ? Set.unmodifiable(enabledSources)
           : null;

  Set<String> get enabledSources {
    final legacy = _legacyEnabled;
    if (legacy != null && legacy.isNotEmpty) {
      final isLegacyTemplate =
          legacy.contains('gestion') ||
          legacy.contains('xataka-mx') ||
          legacy.contains('genbeta');
      if (!isLegacyTemplate) {
        return legacy;
      }
    }
    return defaultSources
        .map((s) => s.id)
        .where((id) => !disabledSources.contains(id))
        .toSet();
  }

  bool isSourceEnabled(String sourceId) {
    if (disabledSources.contains(sourceId)) {
      return false;
    }
    if (sourceId == 'hn' && disabledSources.contains('hackernews')) {
      return false;
    }
    if (sourceId == 'hackernews' && disabledSources.contains('hn')) {
      return false;
    }
    final legacy = _legacyEnabled;
    if (legacy != null && legacy.isNotEmpty) {
      final isLegacyTemplate =
          legacy.contains('gestion') ||
          legacy.contains('xataka-mx') ||
          legacy.contains('genbeta');
      if (isLegacyTemplate) {
        return true;
      }
      return legacy.contains(sourceId) ||
          (sourceId == 'hackernews' && legacy.contains('hn')) ||
          (sourceId == 'hn' && legacy.contains('hackernews'));
    }
    return true;
  }

  ConnectionSettings copyWith({
    String? endpoint,
    String? token,
    Set<String>? disabledSources,
    Set<String>? enabledSources,
  }) => ConnectionSettings(
    endpoint: endpoint ?? this.endpoint,
    token: token ?? this.token,
    disabledSources: disabledSources ?? this.disabledSources,
    enabledSources: enabledSources ?? _legacyEnabled,
  );
}

abstract interface class SettingsRepository {
  Future<ConnectionSettings> read();
  Future<void> save(ConnectionSettings value);
}

class DeviceSettingsRepository implements SettingsRepository {
  final LocalStore local;
  final FlutterSecureStorage secure;
  DeviceSettingsRepository(
    this.local, {
    this.secure = const FlutterSecureStorage(),
  });
  @override
  Future<ConnectionSettings> read() async {
    final prefs = await local.preferences;
    final endpoint =
        prefs.getString('andesEndpoint') ??
        prefs.getString('summaryEndpoint') ??
        defaultAndesEndpoint;
    final token = await secure.read(key: 'andesApiToken') ?? '';
    final disabledList = prefs.getStringList('disabledSources');
    Set<String> disabled = (disabledList ?? const <String>[]).toSet();
    final legacySources = prefs.getStringList('sources');
    Set<String>? legacy;
    if (disabledList == null &&
        legacySources != null &&
        legacySources.isNotEmpty) {
      legacy = legacySources.toSet();
    }
    return ConnectionSettings(
      endpoint: endpoint,
      token: token,
      disabledSources: disabled,
      enabledSources: legacy,
    );
  }

  @override
  Future<void> save(ConnectionSettings value) async {
    final prefs = await local.preferences;
    await secure.write(key: 'andesApiToken', value: value.token);
    if (!await prefs.setString('andesEndpoint', value.endpoint) ||
        !await prefs.setStringList(
          'disabledSources',
          value.disabledSources.toList(),
        ) ||
        !await prefs.setStringList('sources', value.enabledSources.toList())) {
      throw StateError('No se pudo guardar la configuración.');
    }
  }
}
