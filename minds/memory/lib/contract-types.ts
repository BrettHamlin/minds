/**
 * contract-types.ts — Type definitions for contract memory patterns.
 *
 * ContractPattern represents the *shape* of an artifact handoff between Minds,
 * not a specific ticket's data. Patterns accumulate over successful handoffs
 * and inform future handoffs via searchMemory({ scope: "contracts" }).
 *
 * Design: store shapes, never ticket-specific instances.
 * Cold-start: first run returns empty results. Patterns accumulate naturally.
 */

/** Describes the expected shape of a single artifact section. */
export interface SectionDescriptor {
  /** Section heading (e.g. "Acceptance Criteria", "Tech Stack"). */
  name: string;
  /** Whether this section is required for a valid handoff. */
  required: boolean;
  /** Human-readable description of what this section should contain. */
  description: string;
}

/**
 * ContractPattern — a reusable shape description for a Mind-to-Mind handoff.
 *
 * Stores the structural pattern of how artifacts flow from one phase to another:
 * which sections appear, what metadata to expect, and the artifact's overall shape.
 *
 * Patterns are stored in `minds/contracts/` as JSON files and indexed for
 * hybrid BM25 + vector search via the contracts-scoped index.
 */
export interface ContractPattern {
  /** Name of the originating phase/Mind (e.g. "clarify", "spec_api"). */
  sourcePhase: string;
  /** Name of the receiving phase/Mind (e.g. "plan", "execution"). */
  targetPhase: string;
  /**
   * Human-readable description of the artifact's overall shape.
   * Used as the primary searchable content for BM25 + vector retrieval.
   * Example: "Spec document with Summary, Acceptance Criteria, and Tech Stack sections."
   */
  artifactShape: string;
  /**
   * Ordered list of expected sections in the artifact.
   * Describes structure without capturing ticket-specific content.
   */
  sections: SectionDescriptor[];
  /**
   * Key-value metadata about the handoff pattern.
   * Use for categorization, versioning, or domain tags.
   * Example: { "domain": "pipeline", "version": "1.0" }
   */
  metadata: Record<string, string>;
  /** ISO 8601 timestamp when this pattern was recorded. */
  timestamp: string;
}
