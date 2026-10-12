import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:andes_news/main.dart';
import 'package:andes_news/news.dart';

class PreviewService extends NewsService {
  final List<Article> articles;
  PreviewService(this.articles);
  @override
  Future<FeedResult> load(Set<String> enabled) async =>
      FeedResult(articles, {});
  @override
  Future<Article> detail(String id) async =>
      articles.firstWhere((a) => a.id == id);
}

void main() {
  testWidgets('Export current design for visual review', (tester) async {
    if (!const bool.fromEnvironment('EXPORT_PREVIEW')) return;
    final textFont = FontLoader('sans-serif');
    for (final name in ['arial.ttf', 'arialbd.ttf']) {
      textFont.addFont(
        Future.value(
          ByteData.sublistView(
            File('C:/Windows/Fonts/$name').readAsBytesSync(),
          ),
        ),
      );
    }
    await textFont.load();
    final iconFont = FontLoader('MaterialIcons')
      ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
    await iconFont.load();
    final file = File('build/preview-feed.json');
    if (!file.existsSync()) {
      throw StateError('Run tool/check_sources.dart first');
    }
    final articles = (jsonDecode(file.readAsStringSync()) as List)
        .map((j) => Article.fromJson(j))
        .toList();
    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({});
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final key = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: key,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: andesTheme(),
          home: FeedScreen(service: PreviewService(articles)),
        ),
      ),
    );
    await tester.pumpAndSettle();
    Future<void> capture(String name) async {
      expect(tester.takeException(), isNull);
      await tester.runAsync(() async {
        final boundary =
            key.currentContext!.findRenderObject() as RenderRepaintBoundary;
        final image = await boundary.toImage(pixelRatio: 2);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        await Directory('preview').create(recursive: true);
        await File('preview/$name.png')
            .writeAsBytes(data!.buffer.asUint8List());
        image.dispose();
      });
    }

    await capture('inicio');
    await tester.tap(find.text('Descubrir'));
    await tester.pumpAndSettle();
    await capture('descubrir');
    await tester.tap(find.text('Ajustes'));
    await tester.pumpAndSettle();
    await capture('ajustes');
    final bodyFile = File('build/preview-article.json');
    if (bodyFile.existsSync()) {
      final article = Article.fromJson(jsonDecode(bodyFile.readAsStringSync()));
      final prefs = await SharedPreferences.getInstance();
      await tester.pumpWidget(
        RepaintBoundary(
          key: key,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: andesTheme(),
            home: ArticleScreen(
              article: article,
              endpoint: defaultAndesEndpoint,
              prefs: prefs,
              isSaved: false,
              onSave: (_) async {},
              service: PreviewService([article]),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Artículo limpio'));
      await tester.pumpAndSettle();
      await capture('lector');
    }
  });
}
