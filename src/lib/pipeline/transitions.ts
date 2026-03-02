/**
 * Pipeline transition resolution — shared between pipelang runner and orchestrator scripts.
 *
 * Handles both v3.1 object-keyed format and legacy array format for backward
 * compatibility with existing test fixtures.
 */

import type { CompiledGate, CompiledTransition, ConditionalTransitionRow } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface TransitionResult {
  to: string | null;
  gate: string | null;
  if: string | null;
  conditional: boolean;
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Resolve a transition given the current phase and signal type.
 *
 * Supports both pipeline formats:
 *   - Object-keyed (v3.1): uses phases[from].conditionalTransitions + phases[from].transitions[signal]
 *   - Legacy array format: uses top-level transitions[] array (for test fixture compat)
 *
 * Priority rules:
 *   1. conditionalTransitions rows (ordered array with optional "if" field):
 *      first row matching signal is returned; AI evaluates the "if" condition
 *   2. If no conditional row matches, use phases[$from].transitions[$signal] directly
 *   3. If no match at all, return null
 *
 * When plainOnly is true, conditional rows are skipped entirely.
 */
export function resolveTransition(
  currentPhase: string,
  signalType: string,
  pipeline: any,
  plainOnly?: boolean
): TransitionResult | null {
  if (!pipeline?.phases) return null;

  // Object-keyed format (v3.1)
  if (!Array.isArray(pipeline.phases)) {
    const phase = pipeline.phases[currentPhase];
    if (!phase) return null;

    const conditionalRows: ConditionalTransitionRow[] =
      (phase.conditionalTransitions ?? []).filter(
        (r: ConditionalTransitionRow) => r.signal === signalType
      );

    if (!plainOnly && conditionalRows.length > 0) {
      // Return first conditional row — AI evaluates the "if" field
      const first = conditionalRows[0];
      return {
        to: first.to ?? null,
        gate: first.gate ?? null,
        if: first.if ?? null,
        conditional: first.if != null,
      };
    }

    // Direct transition
    const direct = phase.transitions?.[signalType];
    if (direct) {
      return {
        to: (direct as any).to ?? null,
        gate: (direct as any).gate ?? null,
        if: null,
        conditional: false,
      };
    }

    // No direct but had conditional rows
    if (conditionalRows.length > 0) {
      if (plainOnly) {
        // plainOnly: find the "otherwise" row — the fallback with no 'if' field
        const otherwise = conditionalRows.find((r) => r.if == null);
        if (otherwise) {
          return {
            to: otherwise.to ?? null,
            gate: otherwise.gate ?? null,
            if: null,
            conditional: false,
          };
        }
        return null; // no unconditional fallback in conditionalTransitions
      }
      const first = conditionalRows[0];
      return {
        to: first.to ?? null,
        gate: first.gate ?? null,
        if: first.if ?? null,
        conditional: first.if != null,
      };
    }

    return null;
  }

  // Legacy array format
  if (!Array.isArray(pipeline.transitions)) return null;

  interface LegacyRow {
    from: string;
    signal: string;
    to?: string;
    gate?: string;
    if?: string;
  }

  const matches: LegacyRow[] = pipeline.transitions.filter(
    (t: LegacyRow) => t.from === currentPhase && t.signal === signalType
  );

  if (matches.length === 0) return null;

  if (!plainOnly) {
    const conditional = matches.find((t) => t.if != null);
    if (conditional) {
      return {
        to: conditional.to ?? null,
        gate: conditional.gate ?? null,
        if: conditional.if ?? null,
        conditional: true,
      };
    }
  }

  const plain = matches.find((t) => t.if == null);
  if (plain) {
    return {
      to: plain.to ?? null,
      gate: plain.gate ?? null,
      if: null,
      conditional: false,
    };
  }

  const first = matches[0];
  return {
    to: first.to ?? null,
    gate: first.gate ?? null,
    if: first.if ?? null,
    conditional: first.if != null,
  };
}

/**
 * Given a gate, the signal received, and how many times this signal has already
 * triggered a retry, returns either the next phase to run or an error.
 *
 * `retriesSoFar` is the number of times this signal has previously been handled
 * (before this call). The first time a signal fires, pass 0.
 */
export function resolveGateResponse(
  gateName: string,
  gate: CompiledGate,
  signal: string,
  retriesSoFar: number
): { nextPhase: string } | { error: string } {
  const response = gate.on[signal];
  if (!response) {
    return { error: `Gate '${gateName}' has no handler for signal '${signal}'` };
  }

  if (response.maxRetries !== undefined) {
    if (retriesSoFar >= response.maxRetries) {
      const exhaust = response.onExhaust;
      if (exhaust === "skip") {
        if (gate.skipTo) return { nextPhase: gate.skipTo };
        return { error: `Gate '${gateName}' exhausted retries (onExhaust: skip) but no skipTo defined` };
      }
      return { error: `Gate '${gateName}' exhausted retries (onExhaust: ${exhaust ?? "abort"})` };
    }
    if (response.to) return { nextPhase: response.to };
    return { error: `Gate '${gateName}' response for '${signal}' has maxRetries but no 'to' target` };
  }

  if (response.to) return { nextPhase: response.to };

  if (response.onExhaust === "skip") {
    if (gate.skipTo) return { nextPhase: gate.skipTo };
    return { error: `Gate '${gateName}' signal '${signal}' uses onExhaust: skip but gate has no skipTo` };
  }

  return { error: `Gate '${gateName}' signal '${signal}' triggered onExhaust: ${response.onExhaust ?? "abort"}` };
}

/**
 * Resolves a conditional transition for a signal. Scans the conditionalTransitions
 * array for rows matching `signal`, then picks the `otherwise` branch (the row
 * with no `if` field). Condition evaluation (when clauses) is not yet implemented —
 * the otherwise branch is always selected.
 *
 * Returns the matching CompiledTransition, or null if no row matches the signal.
 */
export function resolveConditionalTransition(
  rows: ConditionalTransitionRow[],
  signal: string
): CompiledTransition | null {
  const matching = rows.filter((r) => r.signal === signal);
  if (matching.length === 0) return null;

  const otherwise = matching.find((r) => r.if === undefined) ?? matching[0];

  if (otherwise.to !== undefined) return { to: otherwise.to };
  if (otherwise.gate !== undefined) return { gate: otherwise.gate };
  return null;
}
