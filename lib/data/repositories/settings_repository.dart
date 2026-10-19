import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'dart:convert';

import '../../core/storage/local_store.dart';
import '../models/article.dart';

class ConnectionSettings {
  final List<NewsSource> catalog;
  final String endpoint, token;
  final Set<String> enabledSources;
  ConnectionSettings({
    this.endpoint = defaultAndesEndpoint,
    this.token = '',
    Set<String>? enabledSources,
    List<NewsSource> catalog = sources,
  }) : catalog = List.unmodifiable(catalog),
       enabledSources = Set.unmodifiable(
         enabledSources ?? sources.map((s) => s.id),
       );
  ConnectionSettings copyWith({
    String? endpoint,
    String? token,
    Set<String>? enabledSources,
    List<NewsSource>? catalog,
  }) => ConnectionSettings(
    endpoint: endpoint ?? this.endpoint,
    token: token ?? this.token,
    enabledSources: enabledSources ?? this.enabledSources,
    catalog: catalog ?? this.catalog,
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
    List<NewsSource> catalog = sources;
    try {
      final raw = prefs.getString('sourceCatalog:$endpoint');
      if (raw != null) {
        catalog = (jsonDecode(raw) as List)
            .map((s) => NewsSource.fromJson(Map<String, dynamic>.from(s)))
            .toList();
      }
    } catch (_) {
      /* Keep the built-in catalog when the cache is corrupt. */
    }
    return ConnectionSettings(
      endpoint: endpoint,
      token: token,
      enabledSources: prefs.getStringList('sources')?.toSet(),
      catalog: catalog,
    );
  }

  @override
  Future<void> save(ConnectionSettings value) async {
    final prefs = await local.preferences;
    await secure.write(key: 'andesApiToken', value: value.token);
    if (!await prefs.setString('andesEndpoint', value.endpoint) ||
        !await prefs.setStringList('sources', value.enabledSources.toList()) ||
        !await prefs.setString(
          'sourceCatalog:${value.endpoint}',
          jsonEncode(value.catalog.map((s) => s.toJson()).toList()),
        )) {
      throw StateError('No se pudo guardar la configuración.');
    }
  }
}
