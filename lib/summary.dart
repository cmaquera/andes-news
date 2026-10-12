import 'dart:convert';

import 'package:http/http.dart' as http;

import 'news.dart';

class NewsSummary {
  final String titleEs, summary, basis;
  const NewsSummary(this.titleEs, this.summary, this.basis);
  factory NewsSummary.fromJson(Map<String, dynamic> j) {
    if (j['titleEs'] is! String ||
        (j['titleEs'] as String).trim().isEmpty ||
        j['summary'] is! String ||
        (j['summary'] as String).trim().isEmpty ||
        !['title', 'excerpt'].contains(j['basis'])) {
      throw const FormatException('Respuesta de resumen inválida');
    }
    return NewsSummary(j['titleEs'], j['summary'], j['basis']);
  }
  Map<String, dynamic> toJson() => {
    'titleEs': titleEs,
    'summary': summary,
    'basis': basis,
  };
}

class SummaryException implements Exception {
  final String message;
  const SummaryException(this.message);
  @override
  String toString() => message;
}

bool validSummaryEndpoint(String value) {
  final uri = Uri.tryParse(value);
  return uri != null &&
      uri.hasAuthority &&
      uri.userInfo.isEmpty &&
      uri.query.isEmpty &&
      uri.fragment.isEmpty &&
      (uri.scheme == 'https' ||
          (uri.scheme == 'http' &&
              ['localhost', '127.0.0.1', '10.0.2.2'].contains(uri.host)));
}

class SummaryService {
  final http.Client client;
  SummaryService({http.Client? client}) : client = client ?? http.Client();
  Future<NewsSummary> generate(
    Article article,
    String endpoint,
    String token,
  ) async {
    if (!validSummaryEndpoint(endpoint)) {
      throw const SummaryException(
        'Configura una URL HTTPS válida del servicio de Andes.',
      );
    }
    if (token.length < 32) {
      throw const SummaryException('Configura tu token de acceso en Ajustes.');
    }
    // Disable redirects so a server cannot redirect the bearer token elsewhere.
    final request = http.Request(
      'POST',
      Uri.parse('${endpoint.replaceFirst(RegExp(r'/$'), '')}/summary'),
    )..followRedirects = false;
    request.headers.addAll({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    });
    request.body = jsonEncode({
      'title': article.title.length > 500
          ? article.title.substring(0, 500)
          : article.title,
      'excerpt': article.excerpt.length > 1800
          ? article.excerpt.substring(0, 1800)
          : article.excerpt,
    });
    final response = await http.Response.fromStream(
      await client.send(request).timeout(const Duration(seconds: 100)),
    ).timeout(const Duration(seconds: 100));
    if (response.statusCode == 401) {
      throw const SummaryException(
        'El token de acceso no es válido. Revísalo en Ajustes.',
      );
    }
    if (response.statusCode == 429) {
      throw const SummaryException(
        'El modelo está ocupado. Vuelve a intentarlo en unos segundos.',
      );
    }
    if (response.statusCode == 404) {
      throw const SummaryException(
        'Esta URL no ofrece el servicio de Andes. Usa su dominio, no el de Ollama.',
      );
    }
    if (response.statusCode != 200) {
      throw const SummaryException(
        'El servicio no pudo generar el resumen. Inténtalo de nuevo.',
      );
    }
    return NewsSummary.fromJson(jsonDecode(utf8.decode(response.bodyBytes)));
  }
}
