import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/network/news_service.dart';
import '../core/storage/local_store.dart';
import '../data/repositories/news_repository.dart';
import '../data/repositories/settings_repository.dart';
import '../data/repositories/bookmarks_repository.dart';

final localStoreProvider = Provider<LocalStore>((ref) => LocalStore());
final newsServiceProvider = Provider<NewsService>((ref) {
  final service = NewsService();
  ref.onDispose(service.close);
  return service;
});
final newsRepositoryProvider = Provider<NewsRepository>(
  (ref) => ApiNewsRepository(
    ref.watch(newsServiceProvider),
    ref.watch(localStoreProvider),
  ),
);
final settingsRepositoryProvider = Provider<SettingsRepository>(
  (ref) => DeviceSettingsRepository(ref.watch(localStoreProvider)),
);
final bookmarksRepositoryProvider = Provider<BookmarksRepository>(
  (ref) => DeviceBookmarksRepository(ref.watch(localStoreProvider)),
);
