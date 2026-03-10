// minds-events.ts — Minds-specific bus event types and message interface (BRE-444)
//
// Channel convention: `minds-{ticketId}` (separate from collab's `pipeline-{ticketId}`)

export enum MindsEventType {
  WAVE_STARTED = "WAVE_STARTED",
  WAVE_COMPLETE = "WAVE_COMPLETE",
  DRONE_SPAWNED = "DRONE_SPAWNED",
  MIND_STARTED = "MIND_STARTED",
  REVIEW_STARTED = "REVIEW_STARTED",
  REVIEW_FEEDBACK = "REVIEW_FEEDBACK",
  MIND_COMPLETE = "MIND_COMPLETE",
  DRONE_REVIEWING = "DRONE_REVIEWING",
  DRONE_REVIEW_PASS = "DRONE_REVIEW_PASS",
  DRONE_REVIEW_FAIL = "DRONE_REVIEW_FAIL",
  DRONE_MERGING = "DRONE_MERGING",
  DRONE_MERGED = "DRONE_MERGED",
  CONTRACT_FULFILLED = "CONTRACT_FULFILLED",
}

export interface MindsBusMessage {
  /** Channel this message was published on (e.g. `minds-BRE-444`) */
  channel: string;
  /** Agent identifier that sent this message (e.g. `@transport`) */
  from: string;
  /** Event type */
  type: MindsEventType;
  /** Arbitrary event payload */
  payload: unknown;
  /** Ticket ID associated with this message (e.g. `BRE-444`) */
  ticketId: string;
  /** Mind name that produced this message (e.g. `transport`) */
  mindName: string;
}

// ---------------------------------------------------------------------------
// Hook event types (BRE-457)
// ---------------------------------------------------------------------------

export interface MindsHookEvent {
  source: string;        // "drone:signals" or "mind:orchestrator"
  sessionId: string;     // Claude Code session ID (from hook data)
  hookType: string;      // "SubagentStart" | "PostToolUse" | "Stop" | etc.
  toolName?: string;     // For tool events: "Bash", "Read", "Write", etc.
  timestamp: number;     // ms epoch
  payload: Record<string, unknown>;  // Raw hook data
}

export const HOOK_TYPES = {
  SUBAGENT_START: "SubagentStart",
  SUBAGENT_STOP: "SubagentStop",
  PRE_TOOL_USE: "PreToolUse",
  POST_TOOL_USE: "PostToolUse",
  POST_TOOL_USE_FAILURE: "PostToolUseFailure",
  SESSION_START: "SessionStart",
  SESSION_END: "SessionEnd",
  STOP: "Stop",
} as const;

// ---------------------------------------------------------------------------
// SSE serialization (BRE-482)
// ---------------------------------------------------------------------------

/**
 * Convert a MindsBusMessage into an SSE-formatted string.
 *
 * Output format:
 *   event: {type}\n
 *   data: {json}\n
 *   \n
 *
 * The JSON data object includes: type, timestamp (ISO-8601), mindName, waveId
 * (extracted from payload when present), and the full payload.
 */
export function serializeEventForSSE(event: MindsBusMessage): string {
  const payload = event.payload as Record<string, unknown> | null | undefined;
  const waveId =
    payload != null && typeof payload === "object" && "waveId" in payload
      ? (payload as Record<string, unknown>).waveId
      : undefined;

  const data = {
    type: event.type,
    timestamp: new Date().toISOString(),
    mindName: event.mindName,
    ...(waveId !== undefined ? { waveId } : {}),
    payload: event.payload,
  };

  return `event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`;
}
