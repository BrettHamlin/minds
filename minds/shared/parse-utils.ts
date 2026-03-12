/**
 * parse-utils.ts — Shared parsing utilities for the Minds system.
 */

/**
 * Extract the last JSON line from a multiline string.
 *
 * Subprocess stdout often contains log lines before the final JSON object.
 * This finds the last line that starts with "{" and returns it.
 *
 * @returns The JSON line string, or null if none found.
 */
export function extractLastJsonLine(output: string): string | null {
  return output.trim().split("\n").reverse().find(l => l.startsWith("{")) ?? null;
}
