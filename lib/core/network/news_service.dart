import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../data/models/article.dart';
import '../errors/feed_exception.dart';

bool validAndesEndpoint(String value) {
  final u = Uri.tryParse(value);
  return u != null &&
      u.hasAuthority &&
      u.userInfo.isEmpty &&
      u.query.isEmpty &&
      u.fragment.isEmpty &&
      (u.scheme == 'https' ||
          (u.scheme == 'http' &&
              ['127.0.0.1', 'localhost', '10.0.2.2'].contains(u.host)));
}

class NewsService {
  final http.Client client;
  final bool _ownsClient;
  String endpoint, token;
  NewsService({
    http.Client? client,
    this.endpoint = defaultAndesEndpoint,
    this.token = '',
  }) : client = client ?? http.Client(),
       _ownsClient = client == null;
  void close() {
    if (_ownsClient) client.close();
  }

  void configure(String value, String credential) {
    endpoint = value;
    token = credential;
  }

  Future<Map<String, dynamic>> getJson(
    String path, {
    bool requireToken = false,
  }) async {
    if (!validAndesEndpoint(endpoint)) {
      throw const FeedException('Configura la URL HTTPS de Andes en Ajustes.');
    }
    if (requireToken && token.length < 32) {
      throw const FeedException(
        'Configura tu token de acceso en Ajustes para cargar las noticias del servidor.',
      );
    }
    final request = http.Request(
      'GET',
      Uri.parse('${endpoint.replaceFirst(RegExp(r'/$'), '')}$path'),
    )..followRedirects = false;
    if (token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    late http.Response r;
    try {
      r = await http.Response.fromStream(
        await client.send(request).timeout(const Duration(seconds: 25)),
      ).timeout(const Duration(seconds: 25));
    } catch (_) {
      throw const FeedException(
        'No se pudo conectar con Andes. Conservamos tu última carga.',
        kind: FeedFailureKind.network,
      );
    }
    if (r.statusCode == 401) {
      throw const FeedException(
        'El token no es válido. Revísalo en Ajustes.',
        kind: FeedFailureKind.authentication,
      );
    }
    if (r.statusCode == 404 && path.startsWith('/articles/')) {
      throw const FeedException(
        'Esta noticia ya no está disponible en el servidor. Puedes leer la copia guardada.',
        kind: FeedFailureKind.notFound,
      );
    }
    if (r.statusCode == 404 || r.statusCode == 410) {
      throw const FeedException(
        'El servidor no admite esta ruta. Revisa la URL y la versión del backend.',
        kind: FeedFailureKind.incompatible,
      );
    }
    if (r.statusCode != 200) {
      throw const FeedException(
        'El servidor no pudo responder. Inténtalo de nuevo.',
        kind: FeedFailureKind.server,
      );
    }
    try {
      return jsonDecode(utf8.decode(r.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      throw const FeedException(
        'El servidor devolvió datos con un formato inesperado.',
        kind: FeedFailureKind.invalidData,
      );
    }
  }

  Future<FeedResult> load([Set<String>? enabled]) async {
    try {
      final data = await getJson('/articles?limit=200');
      var rows = (data['articles'] as List).map(
        (j) => Article.fromJson(Map<String, dynamic>.from(j)),
      );
      if (enabled != null) {
        rows = rows.where((a) => enabled.contains(a.sourceId));
      }
      final list = rows.toList();
      final collection = data['collection'] as Map<String, dynamic>?;
      return FeedResult(
        list,
        (collection?['errors'] as Map<String, dynamic>? ?? {}).map(
          (key, value) => MapEntry(key, value.toString()),
        ),
        collectedAt: DateTime.tryParse(collection?['completedAt'] ?? ''),
        counts: data['counts'] ?? {},
      );
    } on FeedException catch (e) {
      return FeedResult([], {}, error: e.message);
    } catch (_) {
      return FeedResult(
        [],
        {},
        error: 'El servidor devolvió noticias con un formato inesperado. Conservamos tu última carga.',
      );
    }
  }

  Future<List<NewsSource>> fetchSources() async {
    try {
      final data = await getJson('/sources');
      final list = data['sources'] as List? ?? [];
      final result = list
          .map((j) => NewsSource.fromJson(Map<String, dynamic>.from(j)))
          .where((s) => s.id.isNotEmpty)
          .toList();
      return result.isNotEmpty ? result : defaultSources;
    } catch (_) {
      return defaultSources;
    }
  }

  Future<Article> detail(String id) async {
    if (!RegExp(r'^[a-f0-9]{32}$').hasMatch(id)) {
      throw const FeedException(
        'Esta noticia proviene de la versión anterior. Búscala de nuevo en el feed del servidor.',
      );
    }
    final data = await getJson('/articles/$id');
    try {
      return Article.fromJson(data['article']);
    } catch (_) {
      throw const FeedException(
        'El artículo recibido tiene un formato inesperado.',
        kind: FeedFailureKind.invalidData,
      );
    }
  }
}
