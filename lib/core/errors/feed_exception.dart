enum FeedFailureKind {
  authentication,
  notFound,
  incompatible,
  network,
  server,
  invalidData,
  configuration,
}

class FeedException implements Exception {
  final String message;
  final FeedFailureKind kind;
  const FeedException(
    this.message, {
    this.kind = FeedFailureKind.configuration,
  });
  @override
  String toString() => message;
}
