import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../core/ui/news_widgets.dart';
import '../feed/feed_controller.dart';
import 'settings_controller.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});
  @override
  ConsumerState<SettingsScreen> createState() => _SettingsViewState();
}

class _SettingsViewState extends ConsumerState<SettingsScreen> {
  final endpointInput = TextEditingController(),
      tokenInput = TextEditingController();
  SettingsState get state => ref.read(settingsProvider);
  bool get loading => state.loading;
  bool get savingConfig => state.saving;
  Set<String> get enabled => state.value.enabledSources;
  Map<String, String> get errors => ref.read(feedProvider).sourceErrors;
  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      await ref.read(settingsProvider.notifier).initialize();
      if (mounted) {
        endpointInput.text = state.value.endpoint;
        tokenInput.text = state.value.token;
      }
    });
  }

  @override
  void dispose() {
    endpointInput.dispose();
    tokenInput.dispose();
    super.dispose();
  }

  Future<void> saveConfig() async {
    final error = await ref
        .read(settingsProvider.notifier)
        .saveConnection(endpointInput.text, tokenInput.text);
    if (!mounted) return;
    notice(error ?? 'Conexión guardada.');
    if (error == null) await ref.read(feedProvider.notifier).refresh();
  }

  void notice(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  @override
  Widget build(BuildContext context) {
    ref.watch(settingsProvider);
    ref.watch(feedProvider);
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Tu espacio', style: Theme.of(context).textTheme.headlineLarge),
        const SizedBox(height: 8),
        const Text(
          'Conecta el backend y elige las fuentes que quieres ver.',
          style: TextStyle(color: muted, fontSize: 13),
        ),
        const SizedBox(height: 24),
        const Text(
          'CONEXIÓN CON ANDES',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: muted,
            letterSpacing: 1,
          ),
        ),
        const SizedBox(height: 12),
        if (state.error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              state.error!,
              style: const TextStyle(color: Color(0xff976400), fontSize: 12),
            ),
          ),
        const Text(
          'El servidor recoge noticias cada dos horas, extrae su contenido y prepara abstractos y traducciones.',
          style: TextStyle(height: 1.5),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: endpointInput,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: const InputDecoration(
            labelText: 'URL del servicio de Andes',
            hintText: 'https://tu-dominio-de-andes',
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: tokenInput,
          obscureText: true,
          autocorrect: false,
          enableSuggestions: false,
          decoration: const InputDecoration(
            labelText: 'Token de acceso',
            prefixIcon: Icon(Icons.lock_outline),
          ),
        ),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: savingConfig || state.loading ? null : saveConfig,
          icon: const Icon(Icons.check, size: 18),
          label: Text(savingConfig ? 'Guardando…' : 'Guardar conexión'),
        ),
        const SizedBox(height: 10),
        const Text(
          'El token se guarda de forma segura. La app recibe los resultados ya preparados y ofrece lectura limpia del contenido recuperado.',
          style: TextStyle(color: muted, fontSize: 12, height: 1.5),
        ),
        const SizedBox(height: 28),
        const Text(
          'TUS FUENTES',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: muted,
            letterSpacing: 1,
          ),
        ),
        const SizedBox(height: 8),
        ...state.value.catalog.map(
          (s) => SwitchListTile(
            contentPadding: EdgeInsets.zero,
            secondary: SourceBadge(s.id, size: 35),
            title: Text(
              s.name,
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
            ),
            subtitle: Text(
              '${s.region}${errors.containsKey(s.id) ? ' · Sin actualizar' : ''}',
              style: const TextStyle(color: muted, fontSize: 11),
            ),
            value: enabled.contains(s.id),
            onChanged: loading || savingConfig
                ? null
                : (v) async {
                    final error = await ref
                        .read(settingsProvider.notifier)
                        .setSource(s.id, v);
                    if (mounted && error != null) notice(error);
                  },
          ),
        ),
        const SizedBox(height: 20),
        const Text(
          'La región indica el origen de la fuente. Deslizar el feed consulta los resultados del servidor; la recopilación se ejecuta cada dos horas aunque la app esté cerrada.',
          style: TextStyle(fontSize: 12, color: muted, height: 1.5),
        ),
        const SizedBox(height: 18),
        const Divider(),
        const SizedBox(height: 12),
        const Text(
          'Andes · Versión 0.6.1',
          style: TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
        ),
        const SizedBox(height: 8),
        const Text(
          'Diseño adaptado de TrendSpot News App, de Hameed Shah · CC BY 4.0.',
          style: TextStyle(color: muted, fontSize: 11),
        ),
        TextButton(
          onPressed: () => launchUrl(
            Uri.parse(
              'https://www.figma.com/community/file/1339560523860969699/trendspot-news-app',
            ),
            mode: LaunchMode.externalApplication,
          ),
          child: const Text('Ver diseño original'),
        ),
      ],
    );
  }
}
