import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import '../../../data/models/article.dart';

Uri? readerSourceUri(String value) {
  final u = Uri.tryParse(value);
  if (u == null ||
      !['https', 'http'].contains(u.scheme) ||
      !u.hasAuthority ||
      u.userInfo.isNotEmpty ||
      u.port != (u.scheme == 'https' ? 443 : 80) ||
      !u.host.contains('.') ||
      u.host.endsWith('.local') ||
      u.host.endsWith('.localhost') ||
      RegExp(r'^[\d.]+$').hasMatch(u.host) ||
      u.host.contains(':')) {
    return null;
  }
  return u;
}

Uri? readerMediaUri(String value) {
  final u = readerSourceUri(value);
  return u?.scheme == 'https' ? u : null;
}

class ReaderImage extends StatelessWidget {
  final ContentBlock block;
  const ReaderImage(this.block, {super.key});
  @override
  Widget build(BuildContext context) {
    final uri = readerMediaUri(block.url);
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (uri != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.network(
                uri.toString(),
                fit: BoxFit.contain,
                semanticLabel: block.alt.isEmpty
                    ? 'Imagen del artículo'
                    : block.alt,
                errorBuilder: (_, _, _) => const _MediaNotice(
                  'No se pudo cargar la imagen de la fuente.',
                ),
                loadingBuilder: (_, child, progress) => progress == null
                    ? child
                    : const SizedBox(
                        height: 180,
                        child: Center(child: CircularProgressIndicator()),
                      ),
              ),
            )
          else
            const _MediaNotice('Imagen no disponible.'),
          if (block.text.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: SelectableText(
                block.text,
                style: const TextStyle(
                  fontSize: 12,
                  color: Color(0xff7a858d),
                  height: 1.5,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _MediaNotice extends StatelessWidget {
  final String text;
  const _MediaNotice(this.text);
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(18),
    color: const Color(0xfff4f6f7),
    child: Text(text, style: const TextStyle(fontSize: 13)),
  );
}

class ReaderVideo extends StatefulWidget {
  final ContentBlock block;
  const ReaderVideo(this.block, {super.key});
  @override
  State<ReaderVideo> createState() => _ReaderVideoState();
}

class _ReaderVideoState extends State<ReaderVideo> {
  VideoPlayerController? controller;
  bool loading = false;
  String error = '';
  @override
  void dispose() {
    controller?.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(ReaderVideo old) {
    super.didUpdateWidget(old);
    if (old.block.url != widget.block.url) {
      controller?.dispose();
      controller = null;
      error = '';
      loading = false;
    }
  }

  Future<void> play() async {
    final uri = readerMediaUri(widget.block.url);
    if (uri == null) return;
    setState(() => loading = true);
    final video = VideoPlayerController.networkUrl(uri);
    controller = video;
    try {
      await video.initialize().timeout(const Duration(seconds: 30));
      if (!mounted || controller != video) return;
      await video.play();
    } catch (_) {
      if (mounted && controller == video) error = 'La fuente no permite reproducir este video o su formato no es compatible.';
    }
    if (mounted && controller == video) setState(() => loading = false);
  }

  Future<void> external() async {
    final uri = readerMediaUri(widget.block.url);
    if (uri == null) return;
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
    } catch (_) {}
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo abrir el video.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.block, video = controller;
    final direct = b.provider == 'direct' && readerMediaUri(b.url) != null;
    return Container(
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xfff4f6f7),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (direct &&
              video != null &&
              video.value.isInitialized &&
              error.isEmpty) ...[
            AspectRatio(
              aspectRatio: video.value.aspectRatio > 0
                  ? video.value.aspectRatio
                  : 16 / 9,
              child: VideoPlayer(video),
            ),
            VideoProgressIndicator(
              video,
              allowScrubbing: true,
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
            ValueListenableBuilder<VideoPlayerValue>(
              valueListenable: video,
              builder: (_, value, _) => Row(
                children: [
                  IconButton(
                    tooltip: value.isPlaying
                        ? 'Pausar video'
                        : 'Reproducir video',
                    onPressed: () =>
                        value.isPlaying ? video.pause() : video.play(),
                    icon: Icon(
                      value.isPlaying ? Icons.pause : Icons.play_arrow,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      value.hasError
                          ? 'Error de reproducción'
                          : 'Video de la fuente',
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
          ] else ...[
            if (readerMediaUri(b.poster) != null)
              ReaderImage(ContentBlock('image', '', url: b.poster)),
            if (loading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(18),
                  child: CircularProgressIndicator(),
                ),
              )
            else if (direct && error.isEmpty)
              FilledButton.icon(
                onPressed: play,
                icon: const Icon(Icons.play_arrow),
                label: const Text('Reproducir video aquí'),
              ),
            if (!direct)
              Text(
                'Video de ${b.provider.isEmpty ? 'la fuente' : b.provider}. Se abre en su reproductor externo.',
                style: const TextStyle(fontSize: 13, height: 1.5),
              ),
            if (error.isNotEmpty)
              Text(error, style: const TextStyle(fontSize: 13, height: 1.5)),
            if (!direct || error.isNotEmpty)
              TextButton.icon(
                onPressed: readerMediaUri(b.url) == null ? null : external,
                icon: const Icon(Icons.open_in_new, size: 16),
                label: const Text('Abrir video'),
              ),
          ],
          if (b.text.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: SelectableText(
                b.text,
                style: const TextStyle(fontSize: 12, height: 1.5),
              ),
            ),
        ],
      ),
    );
  }
}

class _PlacedCell {
  final TableCellData cell;
  final int row, column;
  _PlacedCell(this.cell, this.row, this.column);
}

/// Native table layout supports merged cells and horizontal scrolling.
class ReaderTable extends StatelessWidget {
  final ContentBlock block;
  final double fontSize;
  const ReaderTable(this.block, {super.key, required this.fontSize});
  @override
  Widget build(BuildContext context) {
    final placed = <_PlacedCell>[], occupied = <String>{};
    int columns = 0, rowCount = block.rows.length;
    for (int r = 0; r < block.rows.length; r++) {
      int col = 0;
      for (final cell in block.rows[r]) {
        while (List.generate(
          cell.colSpan,
          (i) => occupied.contains('$r:${col + i}'),
        ).any((v) => v)) {
          col++;
        }
        if (col + cell.colSpan > 50) break;
        placed.add(_PlacedCell(cell, r, col));
        for (int y = r; y < r + cell.rowSpan; y++) {
          for (int x = col; x < col + cell.colSpan; x++) {
            occupied.add('$y:$x');
          }
        }
        columns = math.max(columns, col + cell.colSpan);
        rowCount = math.max(rowCount, r + cell.rowSpan);
        col += cell.colSpan;
      }
    }
    if (columns == 0) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (block.caption.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SelectableText(
                block.caption,
                style: TextStyle(
                  fontSize: fontSize - 2,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          LayoutBuilder(
            builder: (context, constraints) {
              final width = math.max(constraints.maxWidth, columns * 160.0),
                  cellWidth = width / columns;
              final heights = List<double>.filled(rowCount, 40);
              TextStyle style(TableCellData c) => TextStyle(
                fontSize: fontSize - 3,
                height: 1.4,
                fontWeight: c.header ? FontWeight.w700 : FontWeight.w400,
                color: const Color(0xff13181b),
              );
              for (final p in placed) {
                final painter = TextPainter(
                  text: TextSpan(text: p.cell.text, style: style(p.cell)),
                  textDirection: Directionality.of(context),
                  textScaler: MediaQuery.textScalerOf(context),
                )..layout(maxWidth: cellWidth * p.cell.colSpan - 24);
                final required = painter.height + 24;
                final current = heights
                    .skip(p.row)
                    .take(p.cell.rowSpan)
                    .fold<double>(0, (a, b) => a + b);
                if (required > current) {
                  final extra = (required - current) / p.cell.rowSpan;
                  for (int y = p.row; y < p.row + p.cell.rowSpan; y++) {
                    heights[y] += extra;
                  }
                }
                painter.dispose();
              }
              final tops = <double>[0];
              for (final h in heights) {
                tops.add(tops.last + h);
              }
              return SingleChildScrollView(
                primary: false,
                scrollDirection: Axis.horizontal,
                physics: const ClampingScrollPhysics(),
                child: SizedBox(
                  width: width,
                  height: tops.last,
                  child: Stack(
                    children: placed
                        .map(
                          (p) => Positioned(
                            left: p.column * cellWidth,
                            top: tops[p.row],
                            width: p.cell.colSpan * cellWidth,
                            height: tops[p.row + p.cell.rowSpan] - tops[p.row],
                            child: Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: p.cell.header
                                    ? const Color(0xfff0faff)
                                    : Colors.white,
                                border: Border.all(
                                  color: const Color(0xffdce5e9),
                                  width: 0.5,
                                ),
                              ),
                              // SelectableText creates an inner vertical
                              // scrollable per cell that competes with the
                              // article's vertical drag gesture on Android.
                              child: Text(p.cell.text, style: style(p.cell)),
                            ),
                          ),
                        )
                        .toList(),
                  ),
                ),
              );
            },
          ),
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              'Desliza la tabla horizontalmente para ver todas las columnas.',
              style: TextStyle(fontSize: 11, color: Color(0xff7a858d)),
            ),
          ),
        ],
      ),
    );
  }
}
