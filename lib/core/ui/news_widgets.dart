import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../../app/theme.dart';
import '../../data/models/article.dart';

Future<void> shareArticle(BuildContext context, Article article) async {
  final text = article.shareText.trim();
  if (text.isEmpty) return;
  try {
    final box = context.findRenderObject() as RenderBox?;
    final origin = box != null && box.hasSize
        ? box.localToGlobal(Offset.zero) & box.size
        : null;
    await SharePlus.instance.share(
      ShareParams(
        text: text,
        subject: article.displayTitle,
        sharePositionOrigin: origin,
      ),
    );
  } catch (_) {
    await Clipboard.setData(ClipboardData(text: text));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enlace copiado al portapapeles.')),
      );
    }
  }
}

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

Color sourceColor(String id) => switch (id.toLowerCase()) {
  'gestion' => const Color(0xff078383),
  'xataka-mx' || 'xataka' => const Color(0xff2d7343),
  'github' => const Color(0xff24292e),
  'dev' => const Color(0xff13181b),
  'hn' || 'hackernews' => const Color(0xffff6600),
  'reddit' => const Color(0xffff4500),
  'rss' => const Color(0xfff26522),
  'telegram' => const Color(0xff24a1de),
  'x' || 'twitter' => const Color(0xff0f1419),
  _ => const Color(0xff289aca),
};

String sourceInitial(String id) => switch (id.toLowerCase()) {
  'gestion' => 'G',
  'github' => 'GH',
  'dev' => 'DEV',
  'hn' || 'hackernews' => 'Y',
  'xataka-mx' || 'xataka' => 'X',
  'reddit' => 'RD',
  'rss' => 'RSS',
  'telegram' => 'TG',
  'x' || 'twitter' => 'X',
  _ => id.isEmpty ? '?' : id.substring(0, id.length >= 2 ? 2 : 1).toUpperCase(),
};

class SourceBadge extends StatelessWidget {
  final String id;
  final double size;
  const SourceBadge(this.id, {super.key, this.size = 28});
  @override
  Widget build(BuildContext context) {
    final initial = sourceInitial(id);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: sourceColor(id),
        borderRadius: BorderRadius.circular(size * .18),
      ),
      child: Text(
        initial,
        style: TextStyle(
          color: Colors.white,
          fontSize:
              size *
              (initial.length >= 3
                  ? 0.28
                  : initial.length == 2
                  ? 0.38
                  : 0.54),
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class ArticleArtwork extends StatelessWidget {
  final Article article;
  final double borderRadius;
  const ArticleArtwork({
    super.key,
    required this.article,
    this.borderRadius = 8,
  });
  @override
  Widget build(BuildContext context) {
    if (article.imageUrl.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: Image.network(
          article.imageUrl,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => _fallback(),
        ),
      );
    }
    return _fallback();
  }

  Widget _fallback() => Container(
    decoration: BoxDecoration(
      color: pale,
      borderRadius: BorderRadius.circular(borderRadius),
    ),
    alignment: Alignment.center,
    child: SourceBadge(article.sourceId, size: 32),
  );
}

Widget chips(
  List<String> values,
  String selected,
  ValueChanged<String> onSelected,
) => SizedBox(
  height: 48,
  child: ListView.separated(
    padding: const EdgeInsets.symmetric(horizontal: 20),
    scrollDirection: Axis.horizontal,
    itemCount: values.length,
    separatorBuilder: (context, index) => const SizedBox(width: 8),
    itemBuilder: (_, i) {
      final v = values[i];
      final isSel = v == selected;
      return ChoiceChip(
        label: Text(v),
        selected: isSel,
        onSelected: (_) => onSelected(v),
        labelStyle: TextStyle(
          color: isSel ? Colors.white : ink,
          fontSize: 12,
          fontWeight: isSel ? FontWeight.w600 : FontWeight.w500,
        ),
        selectedColor: blue,
        backgroundColor: pale,
        showCheckmark: false,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      );
    },
  ),
);
