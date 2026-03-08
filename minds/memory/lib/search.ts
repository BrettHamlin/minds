/**
 * search.ts — Hybrid BM25 keyword + vector search for per-Mind memory.
 *
 * searchMemory: scoped to a single Mind's memory directory,
 * returns ranked snippets with path + line range.
 *
 * Phase 1: BM25 keyword search via SQLite FTS5.
 * Phase 2: Vector embeddings (placeholder, layered on when available).
 */

import { existsSync } from "fs";
import { Database } from "bun:sqlite";
import { indexPath } from "./index.js";
import { syncIndex } from "./index.js";
import { memoryDir } from "./paths.js";

/** A single search result snippet. */
export interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  /** BM25 rank score (lower = better match in SQLite FTS5). */
  score: number;
}

/** Options for searchMemory. */
export interface SearchOptions {
  /** Maximum number of results to return (default: 10). */
  maxResults?: number;
  /** Minimum score threshold — results with score above this are filtered out.
   *  Note: SQLite FTS5 BM25 scores are negative; more negative = better match.
   *  Default: 0 (return all results, since scores are ≤ 0). */
  minScore?: number;
}

/**
 * Searches a Mind's memory for content matching the query.
 * Uses SQLite FTS5 BM25 ranking. Auto-syncs the index if it doesn't exist.
 *
 * Always scoped to a single Mind — never searches across Minds.
 *
 * @param mindName - Name of the Mind to search
 * @param query - Search query string
 * @param opts - Optional search configuration
 * @returns Ranked array of SearchResult snippets
 */
export async function searchMemory(
  mindName: string,
  query: string,
  opts?: SearchOptions
): Promise<SearchResult[]> {
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

  const db = new Database(dbPath, { readonly: true });
  try {
    // FTS5 BM25 scores are negative (more negative = better match).
    // We order by rank ascending (most negative = best).
    const rows = db
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
      .all(query, maxResults);

    const results: SearchResult[] = rows.map((row) => ({
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      score: row.rank,
    }));

    // Apply minScore filter (score must be <= minScore since BM25 is negative)
    if (opts?.minScore !== undefined) {
      return results.filter((r) => r.score <= opts.minScore!);
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
