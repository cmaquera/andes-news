import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'news.dart';
import 'summary.dart';

const ink = Color(0xff13181b),
    blue = Color(0xff08a9ee),
    muted = Color(0xff7a858d),
    pale = Color(0xfff0faff);
// Retained for callers of the first version's theme.
const green = blue;
String summaryKey(Article a) => 'summary:v2:${a.id}:${a.title}:${a.excerpt}';
void main() => runApp(const AndesApp());
ThemeData andesTheme() => ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(seedColor: blue, primary: blue),
  scaffoldBackgroundColor: Colors.white,
  fontFamily: 'sans-serif',
  textTheme: const TextTheme(
    headlineLarge: TextStyle(
      color: ink,
      fontWeight: FontWeight.w700,
      fontSize: 28,
    ),
    titleLarge: TextStyle(
      color: ink,
      fontWeight: FontWeight.w700,
      fontSize: 21,
    ),
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: Colors.white,
    foregroundColor: ink,
    surfaceTintColor: Colors.transparent,
    elevation: 0,
  ),
  dividerColor: const Color(0xffedf0f2),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: pale,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide.none,
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      backgroundColor: blue,
      foregroundColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
    ),
  ),
  navigationBarTheme: const NavigationBarThemeData(
    backgroundColor: Colors.white,
    indicatorColor: pale,
    surfaceTintColor: Colors.transparent,
  ),
  cardTheme: CardThemeData(
    elevation: 0,
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
      side: const BorderSide(color: Color(0xffedf0f2)),
    ),
  ),
);

class AndesApp extends StatelessWidget {
  const AndesApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Andes · Noticias para devs',
    debugShowCheckedModeBanner: false,
    theme: andesTheme(),
    home: const FeedScreen(),
  );
}

class FeedScreen extends StatefulWidget {
  final NewsService? service;
  const FeedScreen({super.key, this.service});
  @override
  State<FeedScreen> createState() => _FeedState();
}

class _FeedState extends State<FeedScreen> {
  late final service = widget.service ?? NewsService();
  final secure = const FlutterSecureStorage();
  final search = TextEditingController(),
      endpointInput = TextEditingController(),
      tokenInput = TextEditingController();
  SharedPreferences? prefs;
  List<Article> articles = [];
  Map<String, Article> saved = {};
  Map<String, String> errors = {};
  Set<String> enabled = sources.map((s) => s.id).toSet();
  String region = 'Todas',
      topic = 'Todo',
      sourceFilter = '',
      endpoint = '',
      token = '';
  int tab = 0;
  bool loading = true, savingConfig = false;
  DateTime? updated;
  @override
  void initState() {
    super.initState();
    initialize();
  }

  @override
  void dispose() {
    service.client.close();
    search.dispose();
    endpointInput.dispose();
    tokenInput.dispose();
    super.dispose();
  }

  Future<void> initialize() async {
    prefs = await SharedPreferences.getInstance();
    try {
      articles = (jsonDecode(prefs!.getString('feed') ?? '[]') as List)
          .map((j) => Article.fromJson(j))
          .toList();
      saved = {
        for (final j in jsonDecode(prefs!.getString('saved') ?? '[]') as List)
          j['id'] as String: Article.fromJson(j),
      };
    } catch (_) {
      articles = [];
      saved = {};
    }
    enabled = (prefs!.getStringList('sources') ?? enabled.toList()).toSet();
    endpoint = prefs!.getString('summaryEndpoint') ?? '';
    try {
      token = await secure.read(key: 'andesApiToken') ?? '';
    } catch (_) {
      token = '';
    }
    endpointInput.text = endpoint;
    tokenInput.text = token;
    updated = DateTime.tryParse(prefs!.getString('updated') ?? '');
    if (!mounted) return;
    setState(() {});
    await refresh();
  }

  Future<void> refresh() async {
    if (prefs == null || !mounted) return;
    setState(() => loading = true);
    final result = await service.load(enabled);
    final kept = articles.where(
      (a) =>
          enabled.contains(a.sourceId) && result.errors.containsKey(a.sourceId),
    );
    final merged = [...result.articles, ...kept];
    if (result.articles.isNotEmpty) updated = DateTime.now().toUtc();
    await prefs!.setString(
      'feed',
      jsonEncode(merged.map((a) => a.toJson()).toList()),
    );
    if (updated != null) {
      await prefs!.setString('updated', updated!.toIso8601String());
    }
    if (!mounted) return;
    setState(() {
      articles = merged;
      errors = result.errors;
      loading = false;
    });
  }

  Future<void> toggleSaved(Article a) async {
    setState(() {
      if (saved.containsKey(a.id)) {
        saved.remove(a.id);
      } else {
        saved[a.id] = a;
      }
    });
    await prefs?.setString(
      'saved',
      jsonEncode(saved.values.map((a) => a.toJson()).toList()),
    );
  }

  NewsSummary? cachedSummary(Article a) {
    try {
      final raw = prefs?.getString(summaryKey(a));
      return raw == null ? null : NewsSummary.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  String displayTitle(Article a) => cachedSummary(a)?.titleEs ?? a.title;
  List<Article> get visible => (tab == 2 ? saved.values : articles)
      .where(
        (a) =>
            (region == 'Todas' ||
                a.region == region ||
                (region == 'Latinoamérica' && a.region == 'Perú')) &&
            (topic == 'Todo' || a.topic == topic) &&
            (sourceFilter.isEmpty || a.sourceId == sourceFilter) &&
            '${displayTitle(a)} ${a.title} ${a.excerpt} ${a.sourceName}'
                .toLowerCase()
                .contains(search.text.toLowerCase()),
      )
      .toList();
  Future<void> showArticle(Article a) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ArticleScreen(
          article: a,
          endpoint: endpoint,
          token: token,
          prefs: prefs!,
          isSaved: saved.containsKey(a.id),
          onSave: () => toggleSaved(a),
        ),
      ),
    );
    if (mounted) setState(() {});
  }

  void changeTab(int i) {
    setState(() {
      tab = i;
      region = 'Todas';
      topic = 'Todo';
      sourceFilter = '';
      search.clear();
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: RichText(
        text: const TextSpan(
          style: TextStyle(
            fontSize: 23,
            fontFamily: 'sans-serif',
            fontWeight: FontWeight.w800,
            letterSpacing: -.6,
          ),
          children: [
            TextSpan(
              text: 'Andes',
              style: TextStyle(color: ink),
            ),
            TextSpan(
              text: 'News',
              style: TextStyle(color: blue),
            ),
          ],
        ),
      ),
      actions: [
        IconButton(
          tooltip: 'Actualizar noticias',
          onPressed: loading ? null : refresh,
          icon: const Icon(Icons.refresh_rounded, size: 22),
        ),
        IconButton(
          tooltip: 'Ajustes',
          onPressed: () => changeTab(3),
          icon: const Icon(Icons.tune_rounded, size: 22),
        ),
      ],
    ),
    bottomNavigationBar: Container(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Color(0xffedf0f2))),
      ),
      child: NavigationBar(
        height: 70,
        selectedIndex: tab,
        onDestinationSelected: changeTab,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_rounded, color: blue),
            label: 'Inicio',
          ),
          NavigationDestination(
            icon: Icon(Icons.explore_outlined),
            selectedIcon: Icon(Icons.explore, color: blue),
            label: 'Descubrir',
          ),
          NavigationDestination(
            icon: Icon(Icons.bookmark_outline),
            selectedIcon: Icon(Icons.bookmark, color: blue),
            label: 'Guardados',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person, color: blue),
            label: 'Ajustes',
          ),
        ],
      ),
    ),
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: tab == 3 ? settings() : readingFeed(),
        ),
      ),
    ),
  );
  Widget readingFeed() {
    final items = visible;
    final featuredCount = tab == 0 && search.text.isEmpty && items.length >= 3
        ? 3
        : 0;
    final latest = items.skip(featuredCount).toList();
    return RefreshIndicator(
      onRefresh: refresh,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    tab == 0
                        ? 'Hola, developer'
                        : tab == 1
                        ? 'Descubrir'
                        : 'Tus guardados',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    tab == 0
                        ? 'Tu dosis diaria de tecnología, más cerca de casa.'
                        : tab == 1
                        ? 'Encuentra ideas, herramientas y comunidades.'
                        : 'Lecturas para volver cuando quieras, incluso sin conexión.',
                    style: const TextStyle(
                      fontSize: 13,
                      color: muted,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 18),
                  TextField(
                    controller: search,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      hintText: 'Buscar noticias',
                      hintStyle: TextStyle(fontSize: 13, color: muted),
                      prefixIcon: Icon(Icons.search, size: 20, color: muted),
                      contentPadding: EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ],
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: chips(
              ['Todas', 'Perú', 'Latinoamérica', 'Global'],
              region,
              (v) => setState(() => region = v),
            ),
          ),
          SliverToBoxAdapter(
            child: chips(
              [
                'Todo',
                'Programación',
                'IA',
                'Open source',
                'Seguridad',
                'Tecnología',
              ],
              topic,
              (v) => setState(() => topic = v),
            ),
          ),
          if (tab == 1) SliverToBoxAdapter(child: publisherStrip()),
          if (loading)
            const SliverToBoxAdapter(
              child: LinearProgressIndicator(minHeight: 2),
            ),
          if (errors.isNotEmpty && tab != 2)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                child: Text(
                  '${errors.length} fuente(s) sin actualizar. Conservamos su última carga.',
                  style: const TextStyle(
                    fontSize: 11,
                    color: Color(0xff976400),
                  ),
                ),
              ),
            ),
          if (featuredCount > 0) ...[
            SliverToBoxAdapter(
              child: sectionTitle(
                'En tu radar',
                action: 'Ver todo',
                onTap: () => changeTab(1),
              ),
            ),
            SliverToBoxAdapter(
              child: SizedBox(
                height: 240,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  itemCount: featuredCount,
                  separatorBuilder: (_, i) => const SizedBox(width: 12),
                  itemBuilder: (_, i) => featuredCard(items[i]),
                ),
              ),
            ),
          ],
          SliverToBoxAdapter(
            child: sectionTitle(
              tab == 2
                  ? 'Para leer después'
                  : tab == 1
                  ? 'Noticias'
                  : 'Para ti',
              action: '${items.length} lecturas',
            ),
          ),
          if (items.isEmpty)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(36),
                child: Column(
                  children: [
                    const Icon(Icons.article_outlined, size: 46, color: blue),
                    const SizedBox(height: 14),
                    Text(
                      loading
                          ? 'Consultando tus fuentes…'
                          : tab == 2
                          ? 'Guarda una noticia para leerla después.'
                          : 'No hay noticias con estos filtros.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: muted),
                    ),
                    if (!loading && tab != 2)
                      TextButton(
                        onPressed: () => setState(() {
                          region = 'Todas';
                          topic = 'Todo';
                          sourceFilter = '';
                          search.clear();
                        }),
                        child: const Text('Restablecer filtros'),
                      ),
                  ],
                ),
              ),
            ),
          SliverList(
            delegate: SliverChildBuilderDelegate(
              (context, i) => Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: newsRow(latest[i]),
              ),
              childCount: latest.length,
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Text(
                updated == null
                    ? 'Desliza para actualizar'
                    : 'Última carga ${stamp(updated!)}',
                style: const TextStyle(color: muted, fontSize: 11),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget sectionTitle(String title, {String? action, VoidCallback? onTap}) =>
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
        child: Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: ink,
                ),
              ),
            ),
            if (action != null)
              onTap != null
                  ? InkWell(
                      onTap: onTap,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        child: Text(
                          action,
                          style: const TextStyle(
                            color: blue,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    )
                  : Text(
                      action,
                      style: const TextStyle(color: muted, fontSize: 11),
                    ),
          ],
        ),
      );
  Widget chips(
    List<String> values,
    String selected,
    ValueChanged<String> onChange,
  ) => SizedBox(
    height: 41,
    child: ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      scrollDirection: Axis.horizontal,
      itemCount: values.length,
      separatorBuilder: (_, i) => const SizedBox(width: 8),
      itemBuilder: (_, i) => ChoiceChip(
        label: Text(values[i]),
        selected: values[i] == selected,
        onSelected: (_) => onChange(values[i]),
        showCheckmark: false,
        backgroundColor: Colors.white,
        selectedColor: pale,
        side: BorderSide.none,
        labelStyle: TextStyle(
          fontSize: 12,
          color: values[i] == selected ? blue : muted,
          fontWeight: values[i] == selected ? FontWeight.w600 : FontWeight.w400,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        padding: const EdgeInsets.symmetric(horizontal: 5),
      ),
    ),
  );
  Widget publisherStrip() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      sectionTitle(
        'Fuentes',
        action: sourceFilter.isEmpty ? 'Todas' : 'Quitar filtro',
        onTap: () => setState(() => sourceFilter = ''),
      ),
      SizedBox(
        height: 94,
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          scrollDirection: Axis.horizontal,
          itemCount: sources.length,
          separatorBuilder: (_, i) => const SizedBox(width: 16),
          itemBuilder: (_, i) {
            final s = sources[i];
            return InkWell(
              onTap: () => setState(
                () => sourceFilter = sourceFilter == s.id ? '' : s.id,
              ),
              child: SizedBox(
                width: 82,
                child: Column(
                  children: [
                    SourceBadge(s.id, size: 42),
                    const SizedBox(height: 8),
                    Text(
                      s.name.split(' ·').first,
                      maxLines: 2,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11,
                        color: sourceFilter == s.id ? blue : ink,
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    ],
  );
  Widget featuredCard(Article a) => SizedBox(
    width: 248,
    child: InkWell(
      onTap: () => showArticle(a),
      borderRadius: BorderRadius.circular(10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 132,
            child: Stack(
              children: [
                Positioned.fill(
                  child: ArticleArtwork(article: a, borderRadius: 10),
                ),
                Positioned(top: 10, left: 10, child: topicTag(a.topic)),
                Positioned(
                  top: 4,
                  right: 4,
                  child: IconButton(
                    tooltip: saved.containsKey(a.id)
                        ? 'Quitar de guardados'
                        : 'Guardar noticia',
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: .92),
                    ),
                    onPressed: () => toggleSaved(a),
                    icon: Icon(
                      saved.containsKey(a.id)
                          ? Icons.bookmark
                          : Icons.bookmark_border,
                      size: 18,
                      color: ink,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Text(
            displayTitle(a),
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              height: 1.35,
              color: ink,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              SourceBadge(a.sourceId, size: 15),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  a.sourceName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10, color: muted),
                ),
              ),
              Text(
                a.region,
                style: const TextStyle(fontSize: 10, color: muted),
              ),
            ],
          ),
        ],
      ),
    ),
  );
  Widget newsRow(Article a) => InkWell(
    onTap: () => showArticle(a),
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              SourceBadge(a.sourceId, size: 25),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      a.sourceName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 12,
                        color: ink,
                      ),
                    ),
                    Text(
                      a.region,
                      style: const TextStyle(fontSize: 10, color: muted),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: saved.containsKey(a.id)
                    ? 'Quitar de guardados'
                    : 'Guardar noticia',
                visualDensity: VisualDensity.compact,
                onPressed: () => toggleSaved(a),
                icon: Icon(
                  saved.containsKey(a.id)
                      ? Icons.bookmark
                      : Icons.bookmark_border,
                  color: saved.containsKey(a.id) ? blue : muted,
                  size: 20,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      displayTitle(a),
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: ink,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 8),
                    topicTag(a.topic),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              SizedBox(
                width: 92,
                height: 88,
                child: ArticleArtwork(article: a, borderRadius: 8),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 12,
            runSpacing: 4,
            children: [
              Text(
                a.published == null
                    ? 'Fecha no disponible'
                    : stamp(a.published!),
                style: const TextStyle(fontSize: 10, color: muted),
              ),
              if (a.score > 0)
                Text(
                  '↑ ${a.score} · ${a.comments} comentarios',
                  style: const TextStyle(fontSize: 10, color: muted),
                ),
              if (cachedSummary(a) != null)
                const Text(
                  'Resumen en español',
                  style: TextStyle(fontSize: 10, color: blue),
                ),
            ],
          ),
          const SizedBox(height: 14),
          const Divider(height: 1),
        ],
      ),
    ),
  );
  Future<void> saveConfig() async {
    final value = endpointInput.text.trim(), newToken = tokenInput.text.trim();
    if (value.isNotEmpty && !validSummaryEndpoint(value)) {
      notice('Usa una URL HTTPS sin credenciales del servicio de Andes.');
      return;
    }
    if (value.isNotEmpty && newToken.length < 32) {
      notice('Introduce el token de acceso configurado en el servidor.');
      return;
    }
    setState(() => savingConfig = true);
    try {
      await secure.write(key: 'andesApiToken', value: newToken);
      await prefs!.setString('summaryEndpoint', value);
      endpoint = value;
      token = newToken;
      notice('Servicio guardado.');
    } catch (_) {
      notice('No se pudo guardar el acceso en el teléfono.');
    }
    if (mounted) setState(() => savingConfig = false);
  }

  Widget settings() => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      Text('Tu espacio', style: Theme.of(context).textTheme.headlineLarge),
      const SizedBox(height: 8),
      const Text(
        'Personaliza las fuentes y conecta tus resúmenes.',
        style: TextStyle(color: muted, fontSize: 13),
      ),
      const SizedBox(height: 24),
      const Text(
        'RESÚMENES EN ESPAÑOL',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: muted,
          letterSpacing: 1,
        ),
      ),
      const SizedBox(height: 12),
      const Text(
        'Titulares traducidos y una síntesis breve, generados por tu modelo local.',
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
        onPressed: savingConfig || prefs == null ? null : saveConfig,
        icon: const Icon(Icons.check, size: 18),
        label: Text(savingConfig ? 'Guardando…' : 'Guardar conexión'),
      ),
      const SizedBox(height: 10),
      const Text(
        'El token se guarda en el almacenamiento seguro del teléfono. El resumen utiliza el extracto disponible; abre la fuente para leer el artículo completo.',
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
      ...sources.map(
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
          onChanged: loading
              ? null
              : (v) async {
                  setState(() {
                    if (v) {
                      enabled.add(s.id);
                    } else {
                      enabled.remove(s.id);
                    }
                  });
                  await prefs!.setStringList('sources', enabled.toList());
                  await refresh();
                },
        ),
      ),
      const SizedBox(height: 20),
      const Text(
        'La región indica el origen de la fuente. Las noticias se actualizan al abrir la app o deslizar el feed.',
        style: TextStyle(fontSize: 12, color: muted, height: 1.5),
      ),
      const SizedBox(height: 18),
      const Divider(),
      const SizedBox(height: 12),
      const Text(
        'Andes · Versión 0.2',
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
  void notice(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }
}

Widget topicTag(String text) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
  decoration: BoxDecoration(
    color: pale,
    borderRadius: BorderRadius.circular(4),
  ),
  child: Text(
    text,
    style: const TextStyle(
      color: blue,
      fontSize: 10,
      fontWeight: FontWeight.w500,
    ),
  ),
);
String stamp(DateTime date) {
  final d = date.toUtc().subtract(const Duration(hours: 5));
  return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} · ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')} PE';
}

Color sourceColor(String id) => switch (id) {
  'gestion' => const Color(0xff078383),
  'xataka-mx' => const Color(0xff2d7343),
  'github' => const Color(0xff23292f),
  'dev' => const Color(0xff13181b),
  'hn' => const Color(0xffff6600),
  _ => const Color(0xff289aca),
};

class SourceBadge extends StatelessWidget {
  final String id;
  final double size;
  const SourceBadge(this.id, {super.key, this.size = 28});
  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: sourceColor(id),
      borderRadius: BorderRadius.circular(size * .18),
    ),
    child: Text(
      switch (id) {
        'gestion' => 'G',
        'github' => 'GH',
        'dev' => 'DEV',
        'hn' => 'Y',
        'xataka-mx' => 'X',
        _ => 'g',
      },
      style: TextStyle(
        color: Colors.white,
        fontSize:
            size *
            (id == 'dev'
                ? 0.27
                : id == 'github'
                ? 0.35
                : 0.56),
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}

class ArticleArtwork extends StatelessWidget {
  final Article article;
  final double borderRadius;
  const ArticleArtwork({
    super.key,
    required this.article,
    this.borderRadius = 10,
  });
  Widget placeholder() => Container(
    decoration: BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [sourceColor(article.sourceId).withValues(alpha: .10), pale],
      ),
    ),
    child: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            switch (article.topic) {
              'IA' => Icons.auto_awesome,
              'Seguridad' => Icons.shield_outlined,
              'Open source' => Icons.account_tree_outlined,
              'Programación' => Icons.code_rounded,
              _ => Icons.memory_rounded,
            },
            size: 34,
            color: sourceColor(article.sourceId).withValues(alpha: .65),
          ),
          const SizedBox(height: 5),
          Text(
            article.topic,
            style: TextStyle(fontSize: 9, color: sourceColor(article.sourceId)),
          ),
        ],
      ),
    ),
  );
  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(borderRadius),
    child: article.imageUrl.isEmpty
        ? placeholder()
        : Image.network(
            article.imageUrl,
            fit: BoxFit.cover,
            width: double.infinity,
            height: double.infinity,
            errorBuilder: (_, error, stack) => placeholder(),
            loadingBuilder: (_, child, progress) =>
                progress == null ? child : placeholder(),
          ),
  );
}

class ArticleScreen extends StatefulWidget {
  final Article article;
  final String endpoint, token;
  final SharedPreferences prefs;
  final bool isSaved;
  final Future<void> Function() onSave;
  final SummaryService? service;
  const ArticleScreen({
    super.key,
    required this.article,
    required this.endpoint,
    this.token = '',
    required this.prefs,
    required this.isSaved,
    required this.onSave,
    this.service,
  });
  @override
  State<ArticleScreen> createState() => _ArticleState();
}

class _ArticleState extends State<ArticleScreen> {
  late final service = widget.service ?? SummaryService();
  NewsSummary? result;
  String? error;
  bool busy = false, saved = false;
  @override
  void initState() {
    super.initState();
    saved = widget.isSaved;
    try {
      final raw = widget.prefs.getString(summaryKey(widget.article));
      if (raw != null) result = NewsSummary.fromJson(jsonDecode(raw));
    } catch (_) {}
  }

  @override
  void dispose() {
    service.client.close();
    super.dispose();
  }

  Future<void> summarize() async {
    if (widget.endpoint.isEmpty) {
      setState(
        () => error = 'Configura el servicio de Andes en Ajustes. El extracto original está disponible abajo.',
      );
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      final generated = await service.generate(
        widget.article,
        widget.endpoint,
        widget.token,
      );
      await widget.prefs.setString(
        summaryKey(widget.article),
        jsonEncode(generated.toJson()),
      );
      if (mounted) setState(() => result = generated);
    } catch (e) {
      if (mounted) {
        setState(
          () => error = e is SummaryException ? e.message : 'No se pudo conectar. Comprueba tu conexión y vuelve a intentarlo.',
        );
      }
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> openSource() async {
    try {
      if (await launchUrl(
        Uri.parse(widget.article.url),
        mode: LaunchMode.externalApplication,
      )) {
        return;
      }
    } catch (_) {}
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo abrir la fuente.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.article;
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Lectura',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
        actions: [
          IconButton(
            tooltip: 'Guardar noticia',
            onPressed: () async {
              await widget.onSave();
              if (mounted) setState(() => saved = !saved);
            },
            icon: Icon(
              saved ? Icons.bookmark : Icons.bookmark_border,
              color: saved ? blue : ink,
            ),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 30),
            children: [
              Row(
                children: [
                  SourceBadge(a.sourceId, size: 32),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          a.sourceName,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                          ),
                        ),
                        Text(
                          a.region,
                          style: const TextStyle(color: muted, fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                  topicTag(a.topic),
                ],
              ),
              const SizedBox(height: 20),
              Text(
                result?.titleEs ?? a.title,
                style: const TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  height: 1.3,
                  color: ink,
                  letterSpacing: -.5,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                a.published == null
                    ? 'Fecha no disponible'
                    : stamp(a.published!),
                style: const TextStyle(color: muted, fontSize: 11),
              ),
              const SizedBox(height: 20),
              SizedBox(
                height: 205,
                child: ArticleArtwork(article: a, borderRadius: 12),
              ),
              const SizedBox(height: 24),
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: pale,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.auto_awesome, color: blue, size: 20),
                        SizedBox(width: 9),
                        Expanded(
                          child: Text(
                            'En pocas palabras',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      result?.summary ?? 'El titular y lo esencial de esta noticia, en español.',
                      style: const TextStyle(fontSize: 14, height: 1.65),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      (result?.basis ??
                                  (a.excerpt.isEmpty ? 'title' : 'excerpt')) ==
                              'title'
                          ? 'Solo hay un titular: no es un resumen del artículo completo.'
                          : 'Resumen generado por IA a partir del extracto. Verifica los detalles en la fuente.',
                      style: const TextStyle(
                        color: muted,
                        fontSize: 11,
                        height: 1.5,
                      ),
                    ),
                    if (result == null)
                      Padding(
                        padding: const EdgeInsets.only(top: 14),
                        child: FilledButton.icon(
                          onPressed: busy ? null : summarize,
                          icon: busy
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.translate, size: 18),
                          label: Text(
                            busy
                                ? 'Preparando…'
                                : a.excerpt.isEmpty
                                ? 'Traducir titular'
                                : 'Resumir en español',
                          ),
                        ),
                      ),
                    if (error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          error!,
                          style: const TextStyle(
                            color: Color(0xff996100),
                            fontSize: 12,
                            height: 1.5,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 26),
              const Text(
                'Extracto original',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 12),
              if (result != null) ...[
                SelectableText(
                  a.title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 10),
              ],
              SelectableText(
                a.excerpt.isEmpty
                    ? 'La fuente no ofrece un extracto. Abre la publicación para leerla completa.'
                    : a.excerpt,
                style: const TextStyle(
                  fontSize: 15,
                  height: 1.7,
                  color: Color(0xff4e5b65),
                ),
              ),
              const SizedBox(height: 26),
              FilledButton.icon(
                onPressed: openSource,
                icon: const Icon(Icons.open_in_new, size: 18),
                label: const Text('Leer en la fuente original'),
              ),
              const SizedBox(height: 12),
              SelectableText(
                a.url,
                style: const TextStyle(fontSize: 11, color: muted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
