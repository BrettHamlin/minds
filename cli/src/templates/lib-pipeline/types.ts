/**
 * Compiled pipeline types — shared between pipelang compiler and orchestrator scripts.
 *
 * These types describe the output format of `pipelang/cli.ts compile` and are
 * consumed by both the pipelang runner and the orchestrator TypeScript scripts.
 */

// A compiled phase transition — either to a phase or into a gate
export type CompiledTransition = { to: string } | { gate: string };

// A compiled display/prompt value — inline string, AI expression, or file reference
export type CompiledDisplayValue = string | { ai: string } | { file: string };

// A compiled action in an actions block
export type CompiledAction =
  | { display: CompiledDisplayValue }
  | { prompt: CompiledDisplayValue }
  | { command: string };

/** One row in a conditional transition table — an ordered when/otherwise entry */
export interface ConditionalTransitionRow {
  signal: string;
  /** condition expression (absent on the otherwise/fallthrough row) */
  if?: string;
  /** target phase (mutually exclusive with gate) */
  to?: string;
  /** target gate (mutually exclusive with to) */
  gate?: string;
}

export interface CompiledCodeReview {
  enabled: boolean;
  model?: string;
  file?: string;
  maxAttempts?: number;
}

export interface CompiledMetrics {
  enabled: boolean;
}

export interface CompiledPhase {
  command?: string;
  signals?: string[];
  transitions?: Record<string, CompiledTransition>;
  conditionalTransitions?: ConditionalTransitionRow[];
  terminal?: true;
  goal_gate?: "always" | "if_triggered";
  orchestrator_context?: string | { inline: string };
  actions?: CompiledAction[];
  model?: string;
  inputs?: string[];
  outputs?: string[];
  before?: Array<{ phase: string }>;
  after?: Array<{ phase: string }>;
  /** Per-phase codeReview override (only enabled:false is supported from .codeReview(off)) */
  codeReview?: Pick<CompiledCodeReview, "enabled">;
  /** Per-phase metrics override (only enabled:false is supported from .metrics(off)) */
  metrics?: Pick<CompiledMetrics, "enabled">;
}

export interface CompiledGateResponse {
  to?: string; // optional when onExhaust handles routing (e.g. .abort)
  feedback?: "enrich" | "raw";
  maxRetries?: number;
  onExhaust?: "escalate" | "skip" | "abort";
}

export interface CompiledGate {
  prompt: string | { ai: string } | { inline: string };
  skipTo?: string;
  on: Record<string, CompiledGateResponse>;
}

export interface CompiledPipeline {
  version: string;
  defaultModel?: string;
  codeReview?: CompiledCodeReview;
  metrics?: CompiledMetrics;
  phases: Record<string, CompiledPhase>;
  gates?: Record<string, CompiledGate>;
}
