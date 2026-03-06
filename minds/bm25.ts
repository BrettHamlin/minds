/**
 * bm25.ts — BM25 ranking implementation for Mind routing.
 *
 * BM25 scores a query against a corpus of documents (Mind descriptions).
 * Used as the exact-keyword component (30% weight) of hybrid search.
 *
 * Parameters follow the original BM25 paper (Robertson & Zaragoza, 2009):
 *   k1 = 1.5  (term frequency saturation)
 *   b  = 0.75 (document length normalization)
 */

export interface BM25Document {
  id: string;
  tokens: string[];
}

interface TermStats {
  /** Number of documents containing this term */
  df: number;
  /** Map from document ID to term frequency in that doc */
  tf: Map<string, number>;
}

export class BM25Index {
  private readonly k1 = 1.5;
  private readonly b = 0.75;

  private docs: Map<string, BM25Document> = new Map();
  private terms: Map<string, TermStats> = new Map();
  private totalTokens = 0;

  get size(): number {
    return this.docs.size;
  }

  get avgDocLength(): number {
    return this.docs.size === 0 ? 0 : this.totalTokens / this.docs.size;
  }

  /**
   * Add a document to the index.
   * If a document with the same id already exists, it is replaced.
   */
  add(doc: BM25Document): void {
    // Remove old stats if replacing
    if (this.docs.has(doc.id)) {
      this.remove(doc.id);
    }

    this.docs.set(doc.id, doc);
    this.totalTokens += doc.tokens.length;

    const seen = new Set<string>();
    for (const token of doc.tokens) {
      const t = token.toLowerCase();
      const entry = this.terms.get(t) ?? { df: 0, tf: new Map() };
      entry.tf.set(doc.id, (entry.tf.get(doc.id) ?? 0) + 1);
      if (!seen.has(t)) {
        entry.df += 1;
        seen.add(t);
      }
      this.terms.set(t, entry);
    }
  }

  /**
   * Remove a document from the index.
   */
  remove(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;

    this.totalTokens -= doc.tokens.length;
    this.docs.delete(id);

    const seen = new Set<string>();
    for (const token of doc.tokens) {
      const t = token.toLowerCase();
      const entry = this.terms.get(t);
      if (!entry) continue;
      entry.tf.delete(id);
      if (!seen.has(t)) {
        entry.df -= 1;
        seen.add(t);
      }
      if (entry.df === 0) {
        this.terms.delete(t);
      } else {
        this.terms.set(t, entry);
      }
    }
  }

  /**
   * Score all indexed documents against the query tokens.
   * Returns an array of { id, score } sorted descending by score.
   * Documents with score 0 are excluded.
   */
  score(queryTokens: string[]): Array<{ id: string; score: number }> {
    if (this.docs.size === 0 || queryTokens.length === 0) return [];

    const N = this.docs.size;
    const avgdl = this.avgDocLength;
    const scores = new Map<string, number>();

    for (const rawToken of queryTokens) {
      const t = rawToken.toLowerCase();
      const entry = this.terms.get(t);
      if (!entry || entry.df === 0) continue;

      // IDF with smoothing: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((N - entry.df + 0.5) / (entry.df + 0.5) + 1);

      for (const [docId, doc] of this.docs) {
        const tf = entry.tf.get(docId) ?? 0;
        if (tf === 0) continue;

        const dl = doc.tokens.length;
        const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (dl / avgdl)));
        const contrib = idf * tfNorm;
        scores.set(docId, (scores.get(docId) ?? 0) + contrib);
      }
    }

    return Array.from(scores.entries())
      .filter(([, s]) => s > 0)
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score);
  }
}

/**
 * Tokenize a string into lowercase word tokens for BM25.
 * Splits on whitespace and punctuation, removes empties.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_./,;:!?()\[\]{}"']+/)
    .filter((t) => t.length > 0);
}
