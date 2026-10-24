import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../data/models/article.dart';

/// Independently recovers each cache; legacy keys remain readable on upgrade.
class LocalStore {
  final Future<SharedPreferences> preferences;
  LocalStore({Future<SharedPreferences>? preferences})
    : preferences = preferences ?? SharedPreferences.getInstance();
  Future<List<Article>> readArticles(String key) async {
    final prefs = await preferences;
    try {
      final json = jsonDecode(prefs.getString(key) ?? '[]');
      if (json is! List) return const [];
      final articles = <Article>[];
      for (final item in json) {
        try {
          articles.add(Article.fromJson(Map<String, dynamic>.from(item)));
        } catch (_) {
          /* A bad entry must not discard other bookmarks. */
        }
      }
      return List.unmodifiable(articles);
    } catch (_) {
      return const [];
    }
  }

  Future<void> writeArticles(String key, Iterable<Article> articles) async {
    final prefs = await preferences;
    if (!await prefs.setString(
      key,
      jsonEncode(articles.map((a) => a.toJson()).toList()),
    )) {
      throw StateError('No se pudo guardar la caché.');
    }
  }

  Future<List<NewsSource>> readSources() async {
    final prefs = await preferences;
    try {
      final json = jsonDecode(prefs.getString('cached_sources') ?? '[]');
      if (json is! List) return defaultSources;
      final result = json
          .map((item) => NewsSource.fromJson(Map<String, dynamic>.from(item)))
          .where((s) => s.id.isNotEmpty)
          .toList();
      return result.isNotEmpty ? List.unmodifiable(result) : defaultSources;
    } catch (_) {
      return defaultSources;
    }
  }

  Future<void> writeSources(Iterable<NewsSource> sourcesList) async {
    final prefs = await preferences;
    await prefs.setString(
      'cached_sources',
      jsonEncode(sourcesList.map((s) => s.toJson()).toList()),
    );
  }

  Future<Article?> readArticle(String id) async {
    try {
      final raw = (await preferences).getString('article:v3:$id');
      return raw == null ? null : Article.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  Future<void> writeArticle(Article article) async {
    if (!await (await preferences).setString(
      'article:v3:${article.id}',
      jsonEncode(article.toJson()),
    )) {
      throw StateError('No se pudo guardar el artículo.');
    }
  }
}
