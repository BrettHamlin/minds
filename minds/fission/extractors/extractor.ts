/**
 * extractor.ts — Language-agnostic extractor interface.
 *
 * Each supported language implements this interface to produce
 * a DependencyGraph from a target directory.
 */

import type { DependencyGraph } from "../lib/types.js";

export interface Extractor {
  /** Language identifier (e.g., "typescript", "go"). */
  language: string;
  /** File extensions this extractor handles. */
  extensions: string[];
  /** Scan rootDir and return the full import dependency graph. */
  extract(rootDir: string): Promise<DependencyGraph>;
}
