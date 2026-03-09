/**
 * memory-query.ts — Memory search wrapper for clarify ambiguity matching.
 *
 * Wraps searchMemory() from the Memory Mind to classify results as
 * direct matches, partial matches, or non-matches for a given ambiguity.
 *
 * Gracefully degrades when the clarify Mind's memory directory does not
 * exist (first run) — returns empty array instead of throwing.
 */

import { searchMemory } from "../../memory/lib/search.js";
import type { SearchResult } from "../../memory/lib/search.js";

/** A classified memory search result for an ambiguity query. */
export interface MemoryMatch {
  result: SearchResult;
  classification: "direct" | "partial";
  score: number;
}

/**
 * Searches a Mind's memory for prior decisions related to an ambiguity.
 *
 * Classification rules:
 *  - direct  — score > 0.7 AND content contains Q/A format (`Q:` ... `A:`)
 *  - partial — score 0.3–0.7 OR content is related but not a full Q/A match
 *  - Results with score < 0.3 are filtered out (not returned)
 *
 * Gracefully degrades when the memory directory does not exist (first run):
 * returns an empty array and logs a debug message instead of throwing.
 *
 * @param mindName - Name of the Mind to search (e.g. "clarify")
 * @param ambiguityDescription - Description of the ambiguity to look up
 * @returns Ranked array of MemoryMatch results (empty if no memory or no matches)
 */
export async function queryMemoryForAmbiguity(
  mindName: string,
  ambiguityDescription: string
): Promise<MemoryMatch[]> {
  let results: SearchResult[];

  try {
    results = await searchMemory(mindName, ambiguityDescription, { maxResults: 5 });
  } catch (err: any) {
    if (err.message?.includes("memory directory does not exist")) {
      console.debug(
        `No memory found for mind ${mindName}, proceeding without memory context`
      );
      return [];
    }
    throw new Error(
      `queryMemoryForAmbiguity: search failed for mind "${mindName}": ${err.message}`
    );
  }

  const matches: MemoryMatch[] = [];

  for (const result of results) {
    if (result.score < 0.3) {
      // Below threshold — skip
      continue;
    }

    const hasQAFormat = /Q:[\s\S]*?A:/s.test(result.content);
    const classification: "direct" | "partial" =
      result.score > 0.7 && hasQAFormat ? "direct" : "partial";

    matches.push({ result, classification, score: result.score });
  }

  return matches;
}
