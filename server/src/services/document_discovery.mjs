import { createHash } from 'node:crypto';

// Opening an older article must not wait on publishers or rewrite its body.
// Only discovery results are cached, independently of editorial/model output.
export class DocumentDiscovery {
  constructor({ store, discover, now = () => Date.now() }) {
    this.store = store;
    this.discover = discover;
    this.now = now;
    this.pending = new Set();
    this.queue = [];
    this.active = 0;
    this.closed = false;
  }
  read(article) {
    if (
      Array.isArray(article.papers) &&
      (article.papers.length || !article.paperDiscoveryFailures?.length)
    )
      return { status: 'complete', papers: article.papers };
    if (article.paper && Object.keys(article.paper).length)
      return { status: 'complete', papers: [article.paper] };
    const key =
      'scientific-links-v1:' +
      createHash('sha256')
        .update(article.id + article.url)
        .digest('hex');
    const cached = this.store.cached(key);
    if (
      cached &&
      this.now() - cached.checkedAt < (cached.status === 'complete' ? 86400000 : 600000)
    )
      return cached;
    if (this.closed) return { status: 'unavailable', papers: [] };
    if (!this.pending.has(key)) {
      if (this.pending.size >= 20) return { status: 'unavailable', papers: [] };
      this.pending.add(key);
      this.queue.push({ key, article });
      this.pump();
    }
    return { status: 'pending', papers: [] };
  }
  pump() {
    while (!this.closed && this.active < 2 && this.queue.length) {
      const { key, article } = this.queue.shift();
      this.active++;
      Promise.resolve()
        .then(() => this.discover(article))
        .then((result) => {
          if (!this.closed)
            this.store.cache(key, {
              papers: result.papers,
              status: result.failures?.length && !result.papers.length ? 'unavailable' : 'complete',
              checkedAt: this.now(),
            });
        })
        .catch(() => {
          if (!this.closed) {
            try {
              this.store.cache(key, { papers: [], status: 'unavailable', checkedAt: this.now() });
            } catch {
              /* Discovery must not crash the API if its cache cannot be written. */
            }
          }
        })
        .finally(() => {
          this.active--;
          this.pending.delete(key);
          this.pump();
        });
    }
  }
  close() {
    this.closed = true;
    this.queue = [];
  }
}
