/**
 * Pipeline signal parsing and validation — shared between orchestrator scripts.
 *
 * Two signal formats exist:
 *   - Orchestrator full format: [SIGNAL:{TICKET_ID}:{NONCE}] {TYPE} | {DETAIL}
 *   - Pipelang simple format:   [SIGNAL] {TYPE}  (used by pipelang runner/tests)
 */

// ============================================================================
// Constants
// ============================================================================

/** Full orchestrator signal format: [SIGNAL:BRE-123:abc12] CLARIFY_COMPLETE | detail */
export const SIGNAL_REGEX =
  /^\[SIGNAL:([A-Z]+-[0-9]+):([a-f0-9]+)\] ([A-Z_]+) \| (.+)$/;

/** Simple pipelang signal format: [SIGNAL] SIGNAL_NAME */
export const PIPELANG_SIGNAL_RE = /\[SIGNAL\]\s+([A-Z][A-Z0-9_]+)/;

// ============================================================================
// Types
// ============================================================================

export interface ParsedSignal {
  ticketId: string;
  nonce: string;
  signalType: string;
  detail: string;
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Parse a raw orchestrator signal string into its components.
 * Returns null if the format does not match SIGNAL_REGEX.
 */
export function parseSignal(raw: string): ParsedSignal | null {
  const match = raw.match(SIGNAL_REGEX);
  if (!match) return null;

  return {
    ticketId: match[1],
    nonce: match[2],
    signalType: match[3],
    detail: match[4],
  };
}

/**
 * Get allowed signal types for a phase from a compiled pipeline.
 *
 * Supports both formats:
 *   - Object-keyed (v3.1): pipeline.phases[phaseId].signals
 *   - Legacy array format: pipeline.phases[].id === phaseId
 */
export function getAllowedSignals(pipeline: any, phaseId: string): string[] | null {
  if (!pipeline?.phases) return null;

  // Object-keyed format (v3.1)
  if (!Array.isArray(pipeline.phases)) {
    const phase = pipeline.phases[phaseId];
    if (!phase || !Array.isArray(phase.signals)) return null;
    return phase.signals;
  }

  // Legacy array format
  const phase = pipeline.phases.find((p: any) => p.id === phaseId);
  if (!phase || !Array.isArray(phase.signals)) return null;
  return phase.signals;
}
