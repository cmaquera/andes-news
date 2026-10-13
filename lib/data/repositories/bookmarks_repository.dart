import '../../core/storage/local_store.dart';
import '../models/article.dart';

abstract interface class BookmarksRepository {
  Future<List<Article>> read();
  Future<void> save(Iterable<Article> articles);
}

class DeviceBookmarksRepository implements BookmarksRepository {
  final LocalStore local;
  DeviceBookmarksRepository(this.local);
  @override
  Future<List<Article>> read() => local.readArticles('saved');
  @override
  Future<void> save(Iterable<Article> articles) =>
      local.writeArticles('saved', articles);
}
