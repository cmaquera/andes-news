import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:andes_news/article_media.dart';
import 'package:andes_news/news.dart';

final table = ContentBlock(
  'table',
  'Benchmarks',
  caption: 'Resultados',
  rows: [
    [
      TableCellData('Motor', header: true, rowSpan: 2),
      TableCellData('Rendimiento', header: true, colSpan: 2),
    ],
    [
      TableCellData('Lectura', header: true),
      TableCellData('Escritura', header: true),
    ],
    [TableCellData('ExampleDB'), TableCellData('100'), TableCellData('50')],
  ],
);
void main() {
  testWidgets(
    'Vertical drags starting on table cells scroll the article, horizontal drags scroll the table',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final vertical = ScrollController();
      addTearDown(vertical.dispose);
      final longTable = ContentBlock(
        'table',
        '',
        rows: List.generate(
          25,
          (row) => List.generate(6, (col) => TableCellData('Cell $row/$col')),
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ListView(
              controller: vertical,
              children: [
                ReaderTable(longTable, fontSize: 18),
                const SizedBox(height: 1000),
              ],
            ),
          ),
        ),
      );
      final horizontal = tester.state<ScrollableState>(
        find
            .descendant(
              of: find.byType(ReaderTable),
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.dragFrom(
        tester.getCenter(find.text('Cell 2/0')),
        const Offset(-220, 0),
      );
      await tester.pumpAndSettle();
      expect(horizontal.position.pixels, greaterThan(100));
      expect(vertical.offset, 0);
      await tester.dragFrom(const Offset(170, 180), const Offset(0, -220));
      await tester.pumpAndSettle();
      expect(vertical.offset, greaterThan(100));
      final x = horizontal.position.pixels;
      await tester.dragFrom(const Offset(170, 180), const Offset(0, 140));
      await tester.pumpAndSettle();
      expect(horizontal.position.pixels, closeTo(x, 1));
      expect(tester.takeException(), isNull);
    },
  );
  test('Media metadata and table spans survive offline serialization', () {
    final blocks = [
      table,
      ContentBlock(
        'image',
        'Crédito',
        url: 'https://cdn.example.com/photo.webp',
        alt: 'Diagrama',
      ),
      ContentBlock(
        'video',
        'Demostración',
        url: 'https://cdn.example.com/demo.mp4',
        poster: 'https://cdn.example.com/poster.jpg',
        provider: 'direct',
      ),
    ];
    final restored = (jsonDecode(
      jsonEncode(blocks.map((b) => b.toJson()).toList()),
    ) as List).map((b) => ContentBlock.fromJson(b)).toList();
    expect(restored[0].rows[0][0].rowSpan, 2);
    expect(restored[0].rows[0][1].colSpan, 2);
    expect(restored[1].alt, 'Diagrama');
    expect(restored[2].provider, 'direct');
    for (final u in [
      'http://example.com/a',
      'https://127.0.0.1/a',
      'https://user:pass@example.com/a',
      'https://example.com:11434/a',
      'javascript:alert(1)',
    ]) {
      expect(readerMediaUri(u), isNull);
    }
  });
  testWidgets(
    'Merged table renders on a narrow phone and scrolls horizontally',
    (tester) async {
      final preview = const bool.fromEnvironment('EXPORT_PREVIEW');
      if (preview) {
        final loader = FontLoader('Roboto')
          ..addFont(
            Future.value(
              ByteData.sublistView(
                File('C:/Windows/Fonts/arial.ttf').readAsBytesSync(),
              ),
            ),
          );
        await loader.load();
      }
      final boundaryKey = GlobalKey();
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundaryKey,
          child: MaterialApp(
            home: Scaffold(
              body: Padding(
                padding: EdgeInsets.all(22),
                child: ReaderTable(table, fontSize: 24),
              ),
            ),
          ),
        ),
      );
      expect(find.text('Motor'), findsOneWidget);
      expect(find.text('Resultados'), findsOneWidget);
      final position = tester.widget<Positioned>(
        find
            .ancestor(
              of: find.text('Rendimiento'),
              matching: find.byType(Positioned),
            )
            .first,
      );
      expect(position.width, 320);
      expect(tester.takeException(), isNull);
      if (preview) {
        await tester.runAsync(() async {
          final boundary =
              boundaryKey.currentContext!.findRenderObject()
                  as RenderRepaintBoundary;
          final image = await boundary.toImage(pixelRatio: 2);
          final data = await image.toByteData(format: ui.ImageByteFormat.png);
          await File('preview/tabla.png')
              .writeAsBytes(data!.buffer.asUint8List());
          image.dispose();
        });
      }
      await tester.drag(
        find.byType(SingleChildScrollView),
        const Offset(-180, 0),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'Direct video waits for an explicit play; providers expose video link',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: [
                ReaderVideo(
                  ContentBlock(
                    'video',
                    '',
                    url: 'https://cdn.example.com/demo.mp4',
                    provider: 'direct',
                  ),
                ),
                ReaderVideo(
                  ContentBlock(
                    'video',
                    '',
                    url: 'https://www.youtube.com/watch?v=abcdefghijk',
                    provider: 'YouTube',
                  ),
                ),
                ReaderImage(
                  ContentBlock(
                    'image',
                    'Crédito de la fuente',
                    url: 'data:image/png;base64,AA',
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      expect(find.text('Reproducir video aquí'), findsOneWidget);
      expect(find.text('Abrir video'), findsOneWidget);
      expect(find.text('Imagen no disponible.'), findsOneWidget);
      expect(find.text('Crédito de la fuente'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
