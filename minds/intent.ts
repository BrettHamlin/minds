/**
 * intent.ts — Match natural language requests to Mind capabilities using BM25.
 *
 * Single responsibility: given a request string and a list of capability strings,
 * return the best-matching capability, or null if no match clears the threshold.
 */

import { BM25Index, tokenize } from "./bm25.js";

/**
 * Match a natural language request to the best capability from the list.
 *
 * Uses BM25 scoring. Returns the matched capability string, or null if no
 * capability tokens overlap with the request (score stays at 0).
 *
 * @param request     The incoming natural language request.
 * @param capabilities The Mind's declared capability strings.
 * @returns The best-matching capability string, or null.
 */
export function matchIntent(request: string, capabilities: string[]): string | null {
  if (capabilities.length === 0) return null;

  const queryTokens = tokenize(request);
  if (queryTokens.length === 0) return null;

  const index = new BM25Index();
  for (const cap of capabilities) {
    index.add({ id: cap, tokens: tokenize(cap) });
  }

  const results = index.score(queryTokens);
  if (results.length === 0 || results[0].score <= 0) return null;

  return results[0].id;
}
