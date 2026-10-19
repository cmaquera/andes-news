import 'widgets/article_cards.dart';

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../app/providers.dart';
import '../../data/models/article.dart';
import '../../core/network/news_service.dart';
import '../../core/ui/news_widgets.dart';
import '../settings/settings_controller.dart';
import '../settings/settings_screen.dart';
import '../bookmarks/bookmarks_controller.dart';
import '../reader/reader_screen.dart';
import 'feed_controller.dart';

class FeedScreen extends StatelessWidget {
  final NewsService? service;
  const FeedScreen({super.key, this.service});
  @override
  Widget build(BuildContext context) => service == null
      ? const FeedView()
      : ProviderScope(
          overrides: [newsServiceProvider.overrideWithValue(service!)],
          child: const FeedView(),
        );
}

class FeedView extends ConsumerStatefulWidget {
  const FeedView({super.key});
  @override
  ConsumerState<FeedView> createState() => _FeedViewState();
}

class _FeedViewState extends ConsumerState<FeedView> {
  final search = TextEditingController();
  String region = 'Todas', topic = 'Todo', sourceFilter = '';
  int tab = 0;
  FeedState get feed => ref.read(feedProvider);
  List<Article> get articles => feed.articles;
  Map<String, Article> get saved => ref.read(bookmarksProvider).articles;
  Map<String, String> get errors => feed.sourceErrors;
  Map<String, dynamic> get pipelineCounts => feed.counts;
  String? get feedError =>
      tab == 2 ? ref.read(bookmarksProvider).error ?? feed.error : feed.error;
  bool get loading => feed.loading;
  DateTime? get updated => feed.updated;
  Set<String> get enabled => ref.read(settingsProvider).value.enabledSources;
  List<NewsSource> get catalog => ref.read(settingsProvider).value.catalog;
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(feedProvider.notifier).initialize());
  }

  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  Future<void> refresh() => ref.read(feedProvider.notifier).refresh();
  Future<void> toggleSaved(Article article) async {
    final message = await ref.read(bookmarksProvider.notifier).toggle(article);
    if (mounted && message != null) notice(message);
  }

  String? cachedSummary(Article a) => a.abstract.isEmpty ? null : a.abstract;
  String displayTitle(Article a) => a.displayTitle;
  List<Article> get visible => filterArticles(
    tab == 2 ? saved.values : articles,
    enabled: tab == 2 ? saved.values.map((a) => a.sourceId).toSet() : enabled,
    region: region,
    topic: topic,
    source: sourceFilter,
    query: search.text,
  );
  Future<void> showArticle(Article article) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => UncontrolledProviderScope(
          container: ProviderScope.containerOf(context),
          child: ArticleScreen(article: article),
        ),
      ),
    );
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
  Widget build(BuildContext context) {
    ref.watch(feedProvider);
    ref.watch(bookmarksProvider);
    ref.watch(settingsProvider);
    return Scaffold(
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
            child: tab == 3 ? const SettingsScreen() : readingFeed(),
          ),
        ),
      ),
    );
  }

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
              ['Todo', 'Programación', 'IA', 'Open source', 'Seguridad'],
              topic,
              (v) => setState(() => topic = v),
            ),
          ),
          if (tab == 1) SliverToBoxAdapter(child: publisherStrip()),
          if (loading)
            const SliverToBoxAdapter(
              child: LinearProgressIndicator(minHeight: 2),
            ),
          if (feedError != null && tab != 2)
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                child: Text(
                  feedError!,
                  style: const TextStyle(
                    color: Color(0xff976400),
                    fontSize: 12,
                  ),
                ),
              ),
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
          itemCount: catalog.length,
          separatorBuilder: (_, i) => const SizedBox(width: 16),
          itemBuilder: (_, i) {
            final s = catalog[i];
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
  Widget featuredCard(Article a) => FeaturedArticleCard(
    article: a,
    isSaved: saved.containsKey(a.id),
    onOpen: () => showArticle(a),
    onBookmark: () => toggleSaved(a),
  );
  Widget newsRow(Article a) => NewsRow(
    article: a,
    isSaved: saved.containsKey(a.id),
    onOpen: () => showArticle(a),
    onBookmark: () => toggleSaved(a),
  );
  void notice(String text) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    }
  }
}
