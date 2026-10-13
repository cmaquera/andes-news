import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../../core/storage/local_store.dart';
import '../models/article.dart';

class ConnectionSettings {
  final String endpoint, token;
  final Set<String> enabledSources;
  ConnectionSettings({
    this.endpoint = defaultAndesEndpoint,
    this.token = '',
    Set<String>? enabledSources,
  }) : enabledSources = Set.unmodifiable(
         enabledSources ?? sources.map((s) => s.id),
       );
  ConnectionSettings copyWith({
    String? endpoint,
    String? token,
    Set<String>? enabledSources,
  }) => ConnectionSettings(
    endpoint: endpoint ?? this.endpoint,
    token: token ?? this.token,
    enabledSources: enabledSources ?? this.enabledSources,
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
    // Read the old endpoint key once; write the new, accurately named key.
    final endpoint =
        prefs.getString('andesEndpoint') ??
        prefs.getString('summaryEndpoint') ??
        defaultAndesEndpoint;
    final token = await secure.read(key: 'andesApiToken') ?? '';
    return ConnectionSettings(
      endpoint: endpoint,
      token: token,
      enabledSources: prefs.getStringList('sources')?.toSet(),
    );
  }

  @override
  Future<void> save(ConnectionSettings value) async {
    final prefs = await local.preferences;
    await secure.write(key: 'andesApiToken', value: value.token);
    if (!await prefs.setString('andesEndpoint', value.endpoint) ||
        !await prefs.setStringList('sources', value.enabledSources.toList())) {
      throw StateError('No se pudo guardar la configuración.');
    }
  }
}
