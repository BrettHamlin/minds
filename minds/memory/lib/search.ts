/**
 * search.ts — Hybrid BM25 keyword + vector search for per-Mind memory.
 *
 * searchMemory: scoped to a single Mind's memory directory,
 * returns ranked snippets with path + line range.
 *
 * When an EmbeddingProvider is available (auto-created via createEmbeddingProvider):
 *   - Runs FTS5 BM25 keyword search
 *   - Runs vector cosine similarity against stored embeddings
 *   - Merges results via mergeHybridResults() (default 70-30 weighting)
 *
 * When no provider is available:
 *   - Falls back to BM25-only search (graceful degradation, no error)
 */

import { existsSync } from "fs";
import { Database } from "bun:sqlite";
import { indexPath, syncIndex, syncContractIndex, blobToEmbedding } from "./index.js";
import { memoryDir, contractDataDir, contractIndexPath } from "./paths.js";
import { createEmbeddingProvider } from "./embeddings.js";
import type { EmbeddingProvider } from "./embeddings.js";
import { mergeHybridResults } from "./hybrid.js";
import type { VectorSearchResult, BM25SearchResult } from "./hybrid.js";

/** A single search result snippet. */
export interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  /** Merged hybrid score, or BM25 rank score when no provider available.
   *  Higher = better match. */
  score: number;
}

/** Options for searchMemory. */
export interface SearchOptions {
  /** Maximum number of results to return (default: 10). */
  maxResults?: number;
  /** Minimum score threshold — results with score below this are filtered out.
   *  Default: 0 (return all results). */
  minScore?: number;
  /** Explicit embedding provider (bypasses auto-creation, useful for testing). */
  provider?: EmbeddingProvider | null;
  /**
   * Search scope:
   * - `"mind"` (default) — searches a single Mind's memory directory (`minds/{mindName}/memory/`)
   * - `"contracts"` — searches the shared contract data directory (`minds/contracts/`)
   *
   * When `"contracts"`, the `mindName` parameter is ignored (contracts are cross-Mind).
   */
  scope?: "mind" | "contracts";
}

/**
 * Searches memory for content matching the query.
 *
 * When `scope` is `"mind"` (default):
 *   - Searches a single Mind's memory directory (`minds/{mindName}/memory/`)
 *   - Runs hybrid BM25 + vector search when a provider is available
 *   - Falls back to BM25-only when no provider is available
 *   - Auto-syncs the index if it doesn't exist
 *
 * When `scope` is `"contracts"`:
 *   - Searches the shared contract data directory (`minds/contracts/`)
 *   - `mindName` is ignored (contracts are cross-Mind)
 *   - Returns empty array when no patterns exist yet (cold-start safe)
 *   - Same hybrid BM25 + vector infrastructure as mind-scoped search
 *
 * @param mindName - Name of the Mind to search (ignored when scope is "contracts")
 * @param query - Search query string
 * @param opts - Optional search configuration
 * @returns Ranked array of SearchResult snippets
 */
export async function searchMemory(
  mindName: string,
  query: string,
  opts?: SearchOptions
): Promise<SearchResult[]> {
  const scope = opts?.scope ?? "mind";

  // --- Contracts scope ---
  if (scope === "contracts") {
    return searchContracts(query, opts);
  }

  // --- Mind scope (default) ---
  const dir = memoryDir(mindName);
  if (!existsSync(dir)) {
    throw new Error(`searchMemory: memory directory does not exist for mind "${mindName}" at "${dir}"`);
  }

  const maxResults = opts?.maxResults ?? 10;
  const dbPath = indexPath(mindName);

  // Auto-sync index if it doesn't exist
  if (!existsSync(dbPath)) {
    await syncIndex(mindName);
  }

  // Resolve embedding provider (use explicit if provided, otherwise auto-create)
  const provider: EmbeddingProvider | null =
    opts?.provider !== undefined ? opts.provider : await createEmbeddingProvider();

  const db = new Database(dbPath, { readonly: true });
  try {
    // --- BM25 keyword search via FTS5 ---
    const bm25Rows = db
      .query<{
        path: string;
        start_line: number;
        end_line: number;
        content: string;
        rank: number;
      }>(
        `
        SELECT c.path, c.start_line, c.end_line, c.content, bm25(chunks_fts) AS rank
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `
      )
      .all(query, maxResults * 3); // over-fetch for hybrid merge

    // --- Vector search (when provider available and embeddings exist) ---
    if (provider && bm25Rows.length >= 0) {
      const allChunks = db
        .query<{ id: number; path: string; start_line: number; end_line: number; content: string; embedding: Buffer | null }>(
          "SELECT id, path, start_line, end_line, content, embedding FROM chunks WHERE embedding IS NOT NULL"
        )
        .all();

      if (allChunks.length > 0) {
        // Embed the query and compute cosine similarity against all stored embeddings
        const queryVec = await provider.embedQuery(query);

        const vectorResults: VectorSearchResult[] = allChunks
          .map((row) => {
            const chunkVec = blobToEmbedding(row.embedding!);
            const similarity = cosineSimilarity(queryVec, chunkVec);
            return {
              path: row.path,
              startLine: row.start_line,
              endLine: row.end_line,
              content: row.content,
              vectorScore: similarity,
            };
          })
          .filter((r) => r.vectorScore > 0);

        // Sort vector results by score descending for merge
        vectorResults.sort((a, b) => b.vectorScore - a.vectorScore);

        const bm25Results: BM25SearchResult[] = bm25Rows.map((row) => ({
          path: row.path,
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
          bm25Rank: row.rank,
        }));

        const merged = mergeHybridResults(
          vectorResults.slice(0, maxResults * 3),
          bm25Results,
          { maxResults }
        );

        // Apply minScore filter
        if (opts?.minScore !== undefined) {
          return merged.filter((r) => r.score >= opts.minScore!);
        }
        return merged;
      }
    }

    // --- BM25-only fallback ---
    // Reached when: no provider, no stored embeddings, or vector search skipped
    const results: SearchResult[] = bm25Rows.slice(0, maxResults).map((row) => ({
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      // Convert BM25 rank (negative) to positive score for consistent interface
      score: -row.rank,
    }));

    if (opts?.minScore !== undefined) {
      return results.filter((r) => r.score >= opts.minScore!);
    }
    return results;
  } catch (err: any) {
    // FTS5 throws on empty/invalid queries — return empty instead of crashing
    if (err.message?.includes("fts5") || err.message?.includes("no such table")) {
      return [];
    }
    throw new Error(`searchMemory: query failed for mind "${mindName}": ${err.message}`);
  } finally {
    db.close();
  }
}

/**
 * Computes cosine similarity between two L2-normalized vectors.
 * For L2-normalized vectors, cosine similarity equals the dot product.
 *
 * @param a - L2-normalized vector
 * @param b - L2-normalized vector
 * @returns Similarity score in [-1, 1] (typically [0, 1] for non-negative embeddings)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Searches the shared contract data directory using hybrid BM25 + vector search.
 * Returns empty array when no patterns exist (cold-start safe).
 *
 * @param query - Search query string
 * @param opts - Optional search configuration
 * @returns Ranked array of SearchResult snippets
 */
async function searchContracts(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
  const dir = contractDataDir();

  // Cold-start: no contract directory yet — return empty results
  if (!existsSync(dir)) {
    return [];
  }

  const maxResults = opts?.maxResults ?? 10;
  const dbPath = contractIndexPath();

  // Auto-sync contract index if it doesn't exist
  if (!existsSync(dbPath)) {
    await syncContractIndex();
  }

  // Resolve embedding provider
  const provider: EmbeddingProvider | null =
    opts?.provider !== undefined ? opts.provider : await createEmbeddingProvider();

  const db = new Database(dbPath, { readonly: true });
  try {
    const bm25Rows = db
      .query<{
        path: string;
        start_line: number;
        end_line: number;
        content: string;
        rank: number;
      }>(
        `
        SELECT c.path, c.start_line, c.end_line, c.content, bm25(chunks_fts) AS rank
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `
      )
      .all(query, maxResults * 3);

    // Vector search (when provider and stored embeddings available)
    if (provider && bm25Rows.length >= 0) {
      const allChunks = db
        .query<{ id: number; path: string; start_line: number; end_line: number; content: string; embedding: Buffer | null }>(
          "SELECT id, path, start_line, end_line, content, embedding FROM chunks WHERE embedding IS NOT NULL"
        )
        .all();

      if (allChunks.length > 0) {
        const queryVec = await provider.embedQuery(query);

        const vectorResults: VectorSearchResult[] = allChunks
          .map((row) => {
            const chunkVec = blobToEmbedding(row.embedding!);
            const similarity = cosineSimilarity(queryVec, chunkVec);
            return {
              path: row.path,
              startLine: row.start_line,
              endLine: row.end_line,
              content: row.content,
              vectorScore: similarity,
            };
          })
          .filter((r) => r.vectorScore > 0);

        vectorResults.sort((a, b) => b.vectorScore - a.vectorScore);

        const bm25Results: BM25SearchResult[] = bm25Rows.map((row) => ({
          path: row.path,
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
          bm25Rank: row.rank,
        }));

        const merged = mergeHybridResults(
          vectorResults.slice(0, maxResults * 3),
          bm25Results,
          { maxResults }
        );

        if (opts?.minScore !== undefined) {
          return merged.filter((r) => r.score >= opts.minScore!);
        }
        return merged;
      }
    }

    // BM25-only fallback
    const results: SearchResult[] = bm25Rows.slice(0, maxResults).map((row) => ({
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      score: -row.rank,
    }));

    if (opts?.minScore !== undefined) {
      return results.filter((r) => r.score >= opts.minScore!);
    }
    return results;
  } catch (err: any) {
    // FTS5 throws on empty/invalid queries — return empty instead of crashing
    if (err.message?.includes("fts5") || err.message?.includes("no such table")) {
      return [];
    }
    throw new Error(`searchMemory (contracts): query failed: ${err.message}`);
  } finally {
    db.close();
  }
}
