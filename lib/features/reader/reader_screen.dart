import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../data/models/article.dart';
import '../settings/settings_controller.dart';
import '../bookmarks/bookmarks_controller.dart';
import 'reader_controller.dart';
import 'widgets/article_media.dart';

const _blue = blue, _ink = ink, _muted = muted, _pale = pale;

// ListView mounts these wrappers on demand, deferring image/video/table creation
// until the corresponding article block enters the viewport.
class _LazyArticleBlock extends StatelessWidget {
  final Widget Function() child;
  const _LazyArticleBlock({super.key, required this.child});
  @override
  Widget build(BuildContext context) => child();
}

class ArticleScreen extends ConsumerStatefulWidget {
  final Article article;
  const ArticleScreen({super.key, required this.article});
  @override
  ConsumerState<ArticleScreen> createState() => _ReaderState();
}

class _ReaderState extends ConsumerState<ArticleScreen> {
  bool spanish = true;
  String view = 'abstract';
  double fontSize = 18;
  ReaderState get state => ref.read(readerProvider(widget.article));
  Article get article => state.article;
  bool get loading => state.loading;
  String get error => state.error;
  bool get saved =>
      ref.read(bookmarksProvider).articles.containsKey(article.id);
  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      await ref.read(settingsProvider.notifier).initialize();
      if (!mounted) return;
      await ref.read(bookmarksProvider.notifier).initialize();
      if (mounted) {
        await ref.read(readerProvider(widget.article).notifier).initialize();
      }
    });
  }

  Future<void> load() =>
      ref.read(readerProvider(widget.article).notifier).refresh();
  Future<void> openSource([String? url]) async {
    try {
      final uri = readerSourceUri(url ?? article.url);
      if (uri == null) throw const FormatException('Invalid source URL');
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        return;
      }
    } catch (_) {}
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No se pudo abrir la fuente.')),
      );
    }
  }

  Widget block(ContentBlock b) {
    if (b.type == 'image') return ReaderImage(b);
    if (b.type == 'video') {
      return ReaderVideo(b, key: ValueKey('${b.url}:$spanish'));
    }
    if (b.type == 'table') return ReaderTable(b, fontSize: fontSize);
    if (b.type == 'code') {
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xfff4f6f7),
          borderRadius: BorderRadius.circular(8),
        ),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SelectableText(
            b.text,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: fontSize - 3,
              height: 1.5,
            ),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: SelectableText(
        b.type == 'list' ? '• ${b.text}' : b.text,
        style: TextStyle(
          fontSize: b.type == 'heading' ? fontSize + 3 : fontSize,
          fontWeight: b.type == 'heading' ? FontWeight.w700 : FontWeight.w400,
          fontStyle: b.type == 'quote' ? FontStyle.italic : FontStyle.normal,
          color: _ink,
          height: 1.7,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(readerProvider(widget.article));
    ref.watch(bookmarksProvider);
    final blocks = spanish && article.translatedContent.isNotEmpty
        ? article.translatedContent
        : article.content;
    final partial = article.coverage == 'partial';
    return Scaffold(
      appBar: AppBar(
        title: Text(
          article.isScientificDocument
              ? 'Documento científico'
              : article.isNative
              ? 'Publicación original'
              : 'Lectura limpia',
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
        actions: [
          IconButton(
            tooltip: 'Actualizar artículo',
            onPressed: loading ? null : load,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: saved ? 'Quitar de guardados' : 'Guardar noticia',
            onPressed: () async {
              final message = await ref
                  .read(bookmarksProvider.notifier)
                  .toggle(article);
              if (context.mounted && message != null) {
                ScaffoldMessenger.of(context)
                    .showSnackBar(SnackBar(content: Text(message)));
              }
            },
            icon: Icon(
              saved ? Icons.bookmark : Icons.bookmark_border,
              color: saved ? _blue : _ink,
            ),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(22, 12, 22, 32),
            children: [
              Text(
                '${article.sourceName} · ${article.region}',
                style: const TextStyle(
                  color: _blue,
                  fontWeight: FontWeight.w600,
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                article.displayTitle,
                style: const TextStyle(
                  fontSize: 27,
                  height: 1.3,
                  fontWeight: FontWeight.w700,
                  color: _ink,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 12,
                runSpacing: 5,
                children: [
                  if (article.author.isNotEmpty)
                    Text(
                      article.author,
                      style: const TextStyle(color: _muted, fontSize: 11),
                    ),
                  if (article.wordCount > 0 && !article.isScientificDocument)
                    Text(
                      '${article.wordCount} palabras recuperadas',
                      style: const TextStyle(color: _muted, fontSize: 11),
                    ),
                  Text(
                    article.topic,
                    style: const TextStyle(color: _muted, fontSize: 11),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              if (article.editorialScore != null &&
                  article.editorialStatus == 'accepted') ...[
                Text(
                  'Valor editorial: ${article.editorialScore!.toStringAsFixed(1)}/10',
                  style: const TextStyle(color: _blue, fontSize: 12),
                ),
                ...article.selectionReasons.map(
                  (reason) => Text(
                    reason,
                    style: const TextStyle(color: _muted, fontSize: 12),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              if (article.sourceOccurrences.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Encontrado en: ${article.sourceOccurrences.map((s) => s['sourceName']).toSet().join(', ')}',
                    style: const TextStyle(color: _muted, fontSize: 12),
                  ),
                ),
              if (article.isNative)
                const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Texto de la publicación recuperada. Puede ser un mensaje breve o una nota de versión; no representa un artículo completo.',
                    style: TextStyle(color: _muted, fontSize: 12),
                  ),
                ),
              if (article.documentDiscovery == 'pending')
                const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: Text(
                    'Buscando formatos originales de los documentos citados…',
                    style: TextStyle(color: _muted, fontSize: 12),
                  ),
                ),
              if (article.scientificPapers.isNotEmpty) ...[
                for (final paper in article.scientificPapers) ...[
                  if (paper['relation'] == 'reference' ||
                      article.scientificPapers.length > 1)
                    Padding(
                      padding: const EdgeInsets.only(top: 8, bottom: 4),
                      child: Text(
                        paper['title']?.isNotEmpty == true
                            ? paper['title']!
                            : 'Documento científico citado',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  Wrap(
                    spacing: 8,
                    children: [
                      if (readerSourceUri(paper['htmlUrl'] ?? '') != null)
                        OutlinedButton.icon(
                          onPressed: () => openSource(paper['htmlUrl']),
                          icon: const Icon(Icons.language, size: 18),
                          label: const Text('Ver HTML'),
                        ),
                      if (readerSourceUri(paper['pdfUrl'] ?? '') != null)
                        OutlinedButton.icon(
                          onPressed: () => openSource(paper['pdfUrl']),
                          icon: const Icon(
                            Icons.picture_as_pdf_outlined,
                            size: 18,
                          ),
                          label: const Text('Ver PDF'),
                        ),
                      if (readerSourceUri(
                                paper['sourceUrl'] ??
                                    paper['abstractUrl'] ??
                                    '',
                              ) !=
                              null &&
                          (paper['sourceUrl'] ?? paper['abstractUrl']) !=
                              paper['pdfUrl'] &&
                          (paper['sourceUrl'] ?? paper['abstractUrl']) !=
                              paper['htmlUrl'])
                        TextButton(
                          onPressed: () => openSource(
                            paper['sourceUrl'] ?? paper['abstractUrl'],
                          ),
                          child: const Text('Ficha del documento'),
                        ),
                    ],
                  ),
                ],
                if (article.isScientificDocument)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      'Lee aquí el resumen en español. Consulta el HTML o PDF original para ver fórmulas, figuras, tablas, referencias y apéndices.',
                      style: TextStyle(
                        color: _muted,
                        fontSize: 12,
                        height: 1.5,
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
              ],
              if (article.isScientificDocument)
                const Text(
                  'Resumen en español',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                )
              else
                SegmentedButton<String>(
                  segments: [
                    const ButtonSegment(
                      value: 'abstract',
                      label: Text('Abstracto'),
                      icon: Icon(Icons.auto_awesome, size: 17),
                    ),
                    ButtonSegment(
                      value: 'article',
                      label: Text(
                        article.isNative ? 'Publicación' : 'Artículo limpio',
                      ),
                      icon: const Icon(Icons.article_outlined, size: 17),
                    ),
                  ],
                  selected: {view},
                  onSelectionChanged: (v) => setState(() => view = v.first),
                ),
              if (loading)
                const Padding(
                  padding: EdgeInsets.only(top: 16),
                  child: LinearProgressIndicator(minHeight: 2),
                ),
              if (error.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 14),
                  child: Text(
                    error,
                    style: const TextStyle(
                      color: Color(0xff976400),
                      fontSize: 12,
                      height: 1.5,
                    ),
                  ),
                ),
              if (partial && !article.isScientificDocument)
                const Padding(
                  padding: EdgeInsets.only(top: 14),
                  child: Text(
                    'La fuente limita el contenido. Esta lectura y su abstracto cubren únicamente el texto recuperado.',
                    style: TextStyle(
                      color: Color(0xff976400),
                      fontSize: 12,
                      height: 1.5,
                    ),
                  ),
                ),
              const SizedBox(height: 22),
              if (article.isScientificDocument || view == 'abstract') ...[
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: _pale,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: SelectableText(
                    article.abstract.isEmpty
                        ? (article.status == 'unavailable'
                              ? article.isScientificDocument
                                    ? 'No se pudo recuperar el resumen de los autores para preparar el abstracto. Puedes consultar el documento original.'
                                    : 'No se pudo recuperar y procesar este artículo. No generamos un resumen a partir del titular o el RSS.'
                              : 'El servidor está recuperando el artículo y preparando su abstracto. Actualiza más tarde.')
                        : article.abstract,
                    style: TextStyle(fontSize: fontSize, height: 1.7),
                  ),
                ),
                if (article.keyPoints.isNotEmpty) ...[
                  const SizedBox(height: 22),
                  const Text(
                    'Puntos clave',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 12),
                  ...article.keyPoints.map(
                    (point) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Text(
                        '• $point',
                        style: TextStyle(fontSize: fontSize - 2, height: 1.6),
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                Text(
                  article.abstract.isEmpty
                      ? 'Procesamiento automático en el servidor.'
                      : article.isScientificDocument
                      ? [
                              'paper_abstract',
                              'arxiv_abstract',
                            ].contains(article.summaryScope)
                            ? 'Resumen en español basado en el resumen publicado por los autores. Consulta el documento original para verificar los detalles.'
                            : 'Resumen en español para orientarte. Consulta el documento original para verificar los detalles.'
                      : 'Abstracto generado por IA a partir de todas las partes del cuerpo recuperado. Consulta la lectura para verificar los detalles.',
                  style: const TextStyle(
                    color: _muted,
                    fontSize: 11,
                    height: 1.5,
                  ),
                ),
                if (!article.isScientificDocument) ...[
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: () => setState(() => view = 'article'),
                    icon: const Icon(Icons.menu_book_outlined, size: 18),
                    label: const Text('Leer dentro de Andes'),
                  ),
                ],
              ] else ...[
                if (article.translatedContent.isNotEmpty) ...[
                  SegmentedButton<bool>(
                    segments: const [
                      ButtonSegment(value: true, label: Text('Español')),
                      ButtonSegment(value: false, label: Text('Original')),
                    ],
                    selected: {spanish},
                    onSelectionChanged: (v) =>
                        setState(() => spanish = v.first),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    spanish
                        ? 'Traducción automática del texto recuperado. Los bloques de código se conservan.'
                        : 'Contenido original recuperado de la fuente.',
                    style: const TextStyle(
                      color: _muted,
                      fontSize: 11,
                      height: 1.5,
                    ),
                  ),
                ] else
                  const Text(
                    'Contenido original recuperado de la fuente.',
                    style: TextStyle(color: _muted, fontSize: 11),
                  ),
                Row(
                  children: [
                    const Icon(Icons.text_fields, size: 18, color: _muted),
                    Expanded(
                      child: Slider(
                        value: fontSize,
                        min: 16,
                        max: 24,
                        divisions: 4,
                        label: '${fontSize.round()}',
                        onChanged: (v) => setState(() => fontSize = v),
                      ),
                    ),
                  ],
                ),
                if (blocks.isEmpty)
                  Text(
                    article.status == 'unavailable'
                        ? 'La fuente no permitió recuperar una lectura limpia. El enlace original está disponible abajo.'
                        : 'El contenido está pendiente de extracción en el servidor.',
                    style: const TextStyle(color: _muted, height: 1.6),
                  ),
                for (int index = 0; index < blocks.length; index++)
                  _LazyArticleBlock(
                    key: ValueKey('${article.id}:$spanish:$index'),
                    child: () => block(blocks[index]),
                  ),
              ],
              const SizedBox(height: 24),
              const Divider(),
              const SizedBox(height: 12),
              Text(
                'Fuente: ${article.sourceName}. Conservamos el enlace y la atribución originales.',
                style: const TextStyle(
                  color: _muted,
                  fontSize: 11,
                  height: 1.5,
                ),
              ),
              TextButton.icon(
                onPressed: () => openSource(),
                icon: const Icon(Icons.open_in_new, size: 16),
                label: const Text('Abrir sitio original (opcional)'),
              ),
              SelectableText(
                article.url,
                style: const TextStyle(fontSize: 11, color: _muted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
