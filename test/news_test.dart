import 'package:flutter_test/flutter_test.dart';
import 'package:andes_news/news.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('RSS decodes HTML and timezone, preserves region and topic', () {
    const s = NewsSource('gestion', 'Gestión', 'Perú', 'https://example.com');
    final a = parseRss(
      '<rss><channel><item><title>Python &amp; Perú</title><link>https://example.com/news</link><description><![CDATA[<p>Una actualización &amp; más</p>]]></description><pubDate>Mon, 12 Oct 2026 08:00:00 -0500</pubDate></item></channel></rss>',
      s,
    ).single;
    expect(a.title, 'Python & Perú');
    expect(a.excerpt, 'Una actualización & más');
    expect(a.region, 'Perú');
    expect(a.topic, 'Programación');
    expect(a.published, DateTime.utc(2026, 10, 12, 13));
  });
  test('Atom supports namespaces and rejects unsafe links', () {
    const s = NewsSource('github', 'GitHub', 'Global', 'https://example.com');
    final items = parseRss(
      '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>API release</title><link href="https://example.com/a"/><summary>New API</summary><published>2026-10-12T10:00:00Z</published></entry><entry><title>Bad</title><link href="javascript:bad"/></entry></feed>',
      s,
    );
    expect(items.length, 1);
    expect(items.single.url, 'https://example.com/a');
  });
  test(
    'Partial failure reports source error and preserves successful results',
    () async {
      final service = NewsService(
        client: MockClient(
          (request) async => request.url.host == 'gestion.pe'
              ? http.Response('unavailable', 503)
              : http.Response(
                  '<rss><channel><item><title>Python release</title><link>https://example.com/a</link></item></channel></rss>',
                  200,
                ),
        ),
      );
      final result = await service.load({'gestion', 'genbeta'});
      expect(result.articles.length, 1);
      expect(result.errors.keys, ['gestion']);
    },
  );
  test('Different discussion URLs are not deduplicated', () async {
    final service = NewsService(
      client: MockClient(
        (r) async => http.Response(
          '<rss><channel><item><title>API one</title><link>https://example.com/item?id=1</link></item><item><title>API two</title><link>https://example.com/item?id=2</link></item></channel></rss>',
          200,
        ),
      ),
    );
    expect((await service.load({'genbeta'})).articles.length, 2);
  });
}
