/**
 * naming/types.ts -- Types for the LLM naming and validation layer (Stage 4).
 *
 * Defines the ProposedMindMap structure that is the output of the naming
 * pipeline: each cluster receives a name, domain description, keywords,
 * and contract declarations (exposes/consumes).
 */

export interface ProposedMind {
  /** Lowercase, hyphenated Mind name (e.g., "auth", "data-access"). */
  name: string;
  /** 1-2 sentence description of this Mind's responsibilities. */
  domain: string;
  /** 3-8 keywords for intent routing. */
  keywords: string[];
  /** Files owned by this Mind. */
  files: string[];
  /** Glob patterns for MindDescription owns_files. */
  owns_files: string[];
  /** Capabilities this Mind exposes to others. */
  exposes: string[];
  /** Capabilities this Mind consumes from others. */
  consumes: string[];
  /** Number of files in this Mind. */
  fileCount: number;
  /** Cohesion score from the clustering stage. */
  cohesion: number;
}

export interface Recommendation {
  type: "split" | "merge" | "reassign" | "review";
  /** Mind name or file path. */
  target: string;
  /** Why this recommendation is being made. */
  reason: string;
  /** Actionable suggestion. */
  suggestion: string;
}

export interface ProposedMindMap {
  foundation: {
    name: "foundation";
    domain: string;
    files: string[];
    owns_files?: string[];
    exposes: string[];
  };
  minds: ProposedMind[];
  recommendations: Recommendation[];
  couplingMatrix: { from: string; to: string; edges: number }[];
}
