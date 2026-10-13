import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../../data/models/article.dart';

Widget topicTag(String text) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
  decoration: BoxDecoration(
    color: pale,
    borderRadius: BorderRadius.circular(4),
  ),
  child: Text(
    text,
    style: const TextStyle(
      color: blue,
      fontSize: 10,
      fontWeight: FontWeight.w500,
    ),
  ),
);
String stamp(DateTime date) {
  final d = date.toUtc().subtract(const Duration(hours: 5));
  return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} · ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')} PE';
}

Color sourceColor(String id) => switch (id) {
  'gestion' => const Color(0xff078383),
  'xataka-mx' => const Color(0xff2d7343),
  'github' => const Color(0xff23292f),
  'dev' => const Color(0xff13181b),
  'hn' => const Color(0xffff6600),
  _ => const Color(0xff289aca),
};

class SourceBadge extends StatelessWidget {
  final String id;
  final double size;
  const SourceBadge(this.id, {super.key, this.size = 28});
  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      color: sourceColor(id),
      borderRadius: BorderRadius.circular(size * .18),
    ),
    child: Text(
      switch (id) {
        'gestion' => 'G',
        'github' => 'GH',
        'dev' => 'DEV',
        'hn' => 'Y',
        'xataka-mx' => 'X',
        _ => 'g',
      },
      style: TextStyle(
        color: Colors.white,
        fontSize:
            size *
            (id == 'dev'
                ? 0.27
                : id == 'github'
                ? 0.35
                : 0.56),
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}

class ArticleArtwork extends StatelessWidget {
  final Article article;
  final double borderRadius;
  const ArticleArtwork({
    super.key,
    required this.article,
    this.borderRadius = 10,
  });
  Widget placeholder() => Container(
    decoration: BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [sourceColor(article.sourceId).withValues(alpha: .10), pale],
      ),
    ),
    child: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            switch (article.topic) {
              'IA' => Icons.auto_awesome,
              'Seguridad' => Icons.shield_outlined,
              'Open source' => Icons.account_tree_outlined,
              'Programación' => Icons.code_rounded,
              _ => Icons.memory_rounded,
            },
            size: 34,
            color: sourceColor(article.sourceId).withValues(alpha: .65),
          ),
          const SizedBox(height: 5),
          Text(
            article.topic,
            style: TextStyle(fontSize: 9, color: sourceColor(article.sourceId)),
          ),
        ],
      ),
    ),
  );
  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(borderRadius),
    child: article.imageUrl.isEmpty
        ? placeholder()
        : Image.network(
            article.imageUrl,
            fit: BoxFit.cover,
            width: double.infinity,
            height: double.infinity,
            errorBuilder: (_, error, stack) => placeholder(),
            loadingBuilder: (_, child, progress) =>
                progress == null ? child : placeholder(),
          ),
  );
}
