/**
 * router.ts — Hybrid search routing engine for Mind discovery.
 *
 * Combines BM25 exact-keyword matching (30% weight) with vector cosine
 * similarity (70% weight) to route WorkUnits to the best-matched child Mind.
 *
 * Falls back to BM25-only if the vector model is unavailable.
 *
 * QMD-style diversity reranking prevents a single "central" Mind (e.g., Pipeline Core)
 * from dominating every query — diversity bonus rewards less-frequently-top-ranked Minds.
 */

import type { MindDescription } from "./mind.js";
import { BM25Index, tokenize } from "./bm25.js";
import type { EmbeddingModel } from "./embeddings.js";
import { cosineSimilarity } from "./embeddings.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RouteMatch {
  /** The matched Mind's description */
  mind: MindDescription;
  /** Combined score in [0, 1] — higher is a better match */
  score: number;
  /** Suggested role: "primary" | "support" */
  role: "primary" | "support";
}

// ---------------------------------------------------------------------------
// Internal state per indexed Mind
// ---------------------------------------------------------------------------

interface IndexedMind {
  description: MindDescription;
  /** Pre-tokenized corpus (name + domain + keywords + capabilities joined) */
  tokens: string[];
  /** Pre-computed embedding (null if model unavailable) */
  embedding: Float32Array | null;
  /** How many times this Mind has been the top BM25 result — diversity penalty */
  topCount: number;
}

// Weights for hybrid score
const BM25_WEIGHT = 0.3;
const VECTOR_WEIGHT = 0.7;
// QMD diversity penalty (reduces score of frequently-top Minds)
const DIVERSITY_PENALTY = 0.05;

// ---------------------------------------------------------------------------
// MindRouter
// ---------------------------------------------------------------------------

export class MindRouter {
  private indexed: Map<string, IndexedMind> = new Map();
  private bm25 = new BM25Index();
  private model: EmbeddingModel | null = null;

  /**
   * Attach a vector embedding model.
   * If not called (or if model is null), router uses BM25-only mode.
   */
  setModel(model: EmbeddingModel | null): void {
    this.model = model;
  }

  /**
   * Add a Mind to the routing index.
   * Computes BM25 tokens and optionally a vector embedding.
   */
  async addChild(description: MindDescription): Promise<void> {
    const corpus = buildCorpus(description);
    const tokens = tokenize(corpus);

    let embedding: Float32Array | null = null;
    if (this.model) {
      try {
        embedding = await this.model.embed(corpus);
      } catch {
        // Vector embedding failed — BM25 only for this Mind
      }
    }

    const indexed: IndexedMind = { description, tokens, embedding, topCount: 0 };
    this.indexed.set(description.name, indexed);
    this.bm25.add({ id: description.name, tokens });
  }

  /**
   * Remove a Mind from the routing index.
   */
  removeChild(name: string): void {
    this.indexed.delete(name);
    this.bm25.remove(name);
  }

  /**
   * Route a request string to ranked child Minds.
   * Returns up to `limit` matches sorted by combined score (descending).
   * Returns [] if no indexed Minds or no matches above threshold.
   */
  async route(request: string, limit = 5): Promise<RouteMatch[]> {
    if (this.indexed.size === 0) return [];

    const queryTokens = tokenize(request);
    const bm25Scores = scoreBM25(this.bm25.score(queryTokens), this.indexed.size);

    let vectorScores: Map<string, number> | null = null;
    if (this.model) {
      try {
        const queryEmbedding = await this.model.embed(request);
        vectorScores = scoreVector(queryEmbedding, this.indexed);
      } catch {
        // Fall back to BM25-only for this query
      }
    }

    const combined = combineScores(bm25Scores, vectorScores, this.indexed);
    const reranked = applyDiversityPenalty(combined, this.indexed);

    // Update topCount for diversity tracking
    if (reranked.length > 0) {
      const top = this.indexed.get(reranked[0].name);
      if (top) top.topCount += 1;
    }

    return reranked
      .filter((r) => r.score > 0)
      .slice(0, limit)
      .map((r, idx) => ({
        mind: this.indexed.get(r.name)!.description,
        score: r.score,
        role: idx === 0 ? "primary" : "support",
      }));
  }

  get childCount(): number {
    return this.indexed.size;
  }
}

// ---------------------------------------------------------------------------
// Internal scoring helpers
// ---------------------------------------------------------------------------

/**
 * Build the searchable text corpus for a Mind (for BM25 + embedding).
 */
function buildCorpus(desc: MindDescription): string {
  return [
    desc.name.replace(/[-_]/g, " "),
    desc.domain,
    desc.keywords.join(" "),
    desc.capabilities.join(" "),
  ].join(" ");
}

/**
 * Normalize BM25 raw scores to [0, 1] relative to the highest score in the result set.
 */
function scoreBM25(
  raw: Array<{ id: string; score: number }>,
  _corpusSize: number
): Map<string, number> {
  const result = new Map<string, number>();
  if (raw.length === 0) return result;

  const max = raw[0].score; // already sorted descending
  for (const { id, score } of raw) {
    result.set(id, max === 0 ? 0 : score / max);
  }
  return result;
}

/**
 * Compute cosine similarity between the query embedding and each indexed Mind.
 */
function scoreVector(
  queryEmbedding: Float32Array,
  indexed: Map<string, IndexedMind>
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [name, mind] of indexed) {
    if (!mind.embedding) continue;
    const sim = cosineSimilarity(queryEmbedding, mind.embedding);
    // Shift from [-1,1] to [0,1]
    result.set(name, (sim + 1) / 2);
  }
  return result;
}

/**
 * Combine BM25 and vector scores with configured weights.
 * If vectorScores is null (model unavailable), uses BM25-only.
 */
function combineScores(
  bm25: Map<string, number>,
  vector: Map<string, number> | null,
  indexed: Map<string, IndexedMind>
): Array<{ name: string; score: number }> {
  const result: Array<{ name: string; score: number }> = [];

  for (const name of indexed.keys()) {
    const b = bm25.get(name) ?? 0;
    const v = vector?.get(name) ?? null;

    let score: number;
    if (vector === null || v === null) {
      // BM25-only fallback
      score = b;
    } else {
      score = BM25_WEIGHT * b + VECTOR_WEIGHT * v;
    }
    result.push({ name, score });
  }

  return result.sort((a, b) => b.score - a.score);
}

/**
 * QMD-style reranking: apply a small penalty to Minds that have been
 * the top result frequently, encouraging diversity across queries.
 */
function applyDiversityPenalty(
  scored: Array<{ name: string; score: number }>,
  indexed: Map<string, IndexedMind>
): Array<{ name: string; score: number }> {
  return scored
    .map(({ name, score }) => {
      const mind = indexed.get(name);
      const penalty = mind ? mind.topCount * DIVERSITY_PENALTY : 0;
      return { name, score: Math.max(0, score - penalty) };
    })
    .sort((a, b) => b.score - a.score);
}
