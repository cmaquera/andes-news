import 'package:flutter/material.dart';

import '../../../app/theme.dart';
import '../../../data/models/article.dart';
import '../../../core/ui/news_widgets.dart';

class FeaturedArticleCard extends StatelessWidget {
  final Article a;
  final bool isSaved;
  final VoidCallback onOpen, onBookmark;
  const FeaturedArticleCard({
    super.key,
    required Article article,
    required this.isSaved,
    required this.onOpen,
    required this.onBookmark,
  }) : a = article;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: 248,
    child: InkWell(
      onTap: onOpen,
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
                    tooltip: isSaved
                        ? 'Quitar de guardados'
                        : 'Guardar noticia',
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: .92),
                    ),
                    onPressed: onBookmark,
                    icon: Icon(
                      isSaved ? Icons.bookmark : Icons.bookmark_border,
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
            a.displayTitle,
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
}

class NewsRow extends StatelessWidget {
  final Article a;
  final bool isSaved;
  final VoidCallback onOpen, onBookmark;
  const NewsRow({
    super.key,
    required Article article,
    required this.isSaved,
    required this.onOpen,
    required this.onBookmark,
  }) : a = article;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onOpen,
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
                tooltip: isSaved ? 'Quitar de guardados' : 'Guardar noticia',
                visualDensity: VisualDensity.compact,
                onPressed: onBookmark,
                icon: Icon(
                  isSaved ? Icons.bookmark : Icons.bookmark_border,
                  color: isSaved ? blue : muted,
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
                      a.displayTitle,
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
              if (a.abstract.isNotEmpty)
                const Text(
                  'Resumen en español',
                  style: TextStyle(fontSize: 10, color: blue),
                ),
              if (a.abstract.isEmpty)
                Text(
                  a.status == 'unavailable'
                      ? 'Texto no disponible'
                      : 'Procesando en el servidor',
                  style: const TextStyle(fontSize: 10, color: muted),
                ),
            ],
          ),
          const SizedBox(height: 14),
          const Divider(height: 1),
        ],
      ),
    ),
  );
}
