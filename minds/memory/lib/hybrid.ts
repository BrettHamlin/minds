/**
 * hybrid.ts — Hybrid BM25 + vector search merge algorithm.
 *
 * T006: Merges BM25 keyword results with vector similarity results
 * using weighted scoring, optional temporal decay, and optional MMR.
 *
 * Score formula: score = vectorWeight * vectorScore + textWeight * bm25Score
 * Then optional: temporal decay (halfLifeDays=90), MMR re-ranking (lambda=0.5)
 */

import type { SearchResult } from "./search.js";

/** A result from vector similarity search. */
export interface VectorSearchResult {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  /** Cosine similarity score in [0, 1]. Should be L2-normalized. */
  vectorScore: number;
}

/** A result from BM25 (FTS5) keyword search. */
export interface BM25SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  /** Raw BM25 rank from SQLite FTS5 (negative; more negative = better). */
  bm25Rank: number;
}

/** Options for hybrid merge. */
export interface HybridOptions {
  /** Weight applied to vector score (default: 0.7). */
  vectorWeight?: number;
  /** Weight applied to BM25 score (default: 0.3). */
  textWeight?: number;
  /** If set, applies temporal decay with this half-life in days (default: none). */
  halfLifeDays?: number;
  /** If set, applies MMR re-ranking with this lambda value in [0, 1] (default: none).
   *  Higher lambda = more relevance, lower lambda = more diversity. */
  lambda?: number;
  /** Maximum number of results to return (default: 10). */
  maxResults?: number;
}

/**
 * Converts a BM25 result rank position to a normalized score in (0, 1].
 *
 * Uses a positional scoring approach: rank 1 (best BM25 match) → 1.0,
 * rank totalResults (worst match) → 1/totalResults.
 *
 * @param rank - 1-indexed position in BM25 result set (1 = best match)
 * @param totalResults - Total number of BM25 results in the set
 */
export function bm25RankToScore(rank: number, totalResults: number): number {
  if (totalResults <= 0 || rank <= 0) return 0;
  return (totalResults - rank + 1) / totalResults;
}

/**
 * Applies exponential temporal decay to a score based on the age of the file.
 *
 * Extracts a YYYY-MM-DD date from the file path (e.g. daily log files).
 * If no date is found in the path, returns the original score unchanged.
 *
 * @param score - Current merged score
 * @param filePath - File path potentially containing a YYYY-MM-DD date
 * @param halfLifeDays - Days after which score is halved (e.g. 90)
 */
export function applyTemporalDecay(score: number, filePath: string, halfLifeDays: number): number {
  const match = filePath.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) return score;

  const fileDate = new Date(match[1]);
  if (isNaN(fileDate.getTime())) return score;

  const daysSince = (Date.now() - fileDate.getTime()) / (1000 * 60 * 60 * 24);
  const decayFactor = Math.pow(0.5, daysSince / halfLifeDays);
  return score * decayFactor;
}

/**
 * Applies Maximal Marginal Relevance (MMR) re-ranking to reduce redundancy.
 *
 * Greedily selects results that balance relevance (high score) against
 * similarity to already-selected results (measured by content Jaccard overlap).
 *
 * MMR(d) = λ * score(d) - (1 - λ) * max_similarity(d, selected)
 *
 * @param results - Pre-scored results (highest score first)
 * @param lambda - Balance between relevance (1.0) and diversity (0.0)
 * @param maxResults - Maximum results to return
 */
export function mmrRerank(
  results: SearchResult[],
  lambda: number,
  maxResults: number
): SearchResult[] {
  if (results.length === 0) return [];
  if (lambda >= 1) return results.slice(0, maxResults);

  const selected: SearchResult[] = [];
  const remaining = [...results];

  while (selected.length < maxResults && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;
      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((s) => jaccardSimilarity(remaining[i].content, s.content)));

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

/**
 * Merges vector similarity and BM25 keyword results into a single ranked list.
 *
 * Uses a canonical chunk key (path:startLine:endLine) to deduplicate results
 * that appear in both result sets. The merged score combines both signals:
 *   score = vectorWeight * vectorScore + textWeight * bm25Score
 *
 * Optional post-processing:
 *   - Temporal decay: reduces scores for older daily log entries
 *   - MMR re-ranking: reduces redundancy in the final result set
 *
 * @param vectorResults - Vector similarity search results (scores in [0, 1])
 * @param bm25Results - BM25 keyword search results (raw FTS5 ranks)
 * @param opts - Merge options (weights, decay, MMR, maxResults)
 */
export function mergeHybridResults(
  vectorResults: VectorSearchResult[],
  bm25Results: BM25SearchResult[],
  opts?: HybridOptions
): SearchResult[] {
  const vectorWeight = opts?.vectorWeight ?? 0.7;
  const textWeight = opts?.textWeight ?? 0.3;
  const maxResults = opts?.maxResults ?? 10;

  type ChunkKey = string;
  const merged = new Map<
    ChunkKey,
    { path: string; startLine: number; endLine: number; content: string; vectorScore: number; bm25Score: number }
  >();

  // Index vector results
  for (const r of vectorResults) {
    const key: ChunkKey = `${r.path}:${r.startLine}:${r.endLine}`;
    merged.set(key, {
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      content: r.content,
      vectorScore: r.vectorScore,
      bm25Score: 0,
    });
  }

  // Merge BM25 results, converting rank to normalized score
  const totalBM25 = bm25Results.length;
  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i];
    const key: ChunkKey = `${r.path}:${r.startLine}:${r.endLine}`;
    const normalizedBm25 = bm25RankToScore(i + 1, totalBM25); // 1-indexed

    const existing = merged.get(key);
    if (existing) {
      existing.bm25Score = normalizedBm25;
    } else {
      merged.set(key, {
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        content: r.content,
        vectorScore: 0,
        bm25Score: normalizedBm25,
      });
    }
  }

  // Compute weighted scores
  let results: SearchResult[] = Array.from(merged.values()).map((entry) => ({
    path: entry.path,
    startLine: entry.startLine,
    endLine: entry.endLine,
    content: entry.content,
    score: vectorWeight * entry.vectorScore + textWeight * entry.bm25Score,
  }));

  // Optional temporal decay
  if (opts?.halfLifeDays !== undefined) {
    results = results.map((r) => ({
      ...r,
      score: applyTemporalDecay(r.score, r.path, opts.halfLifeDays!),
    }));
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Optional MMR re-ranking
  if (opts?.lambda !== undefined) {
    return mmrRerank(results, opts.lambda, maxResults);
  }

  return results.slice(0, maxResults);
}

/** Jaccard token overlap between two strings (bag-of-words, case-insensitive). */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));

  let intersect = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersect++;
  }

  const union = wordsA.size + wordsB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}
