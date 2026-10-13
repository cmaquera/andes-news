import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/feed/feed_screen.dart';
import 'theme.dart';

class AndesApp extends StatelessWidget {
  const AndesApp({super.key});
  @override
  Widget build(BuildContext context) => ProviderScope(
    child: MaterialApp(
      title: 'Andes · Noticias para devs',
      debugShowCheckedModeBanner: false,
      theme: andesTheme(),
      home: const FeedScreen(),
    ),
  );
}
