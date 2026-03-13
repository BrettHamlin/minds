/**
 * types.ts -- Wire protocol type definitions for the Axon daemon.
 *
 * Mirrors the Rust serde types exactly. Uses discriminated unions on the `t`
 * field (serde tag = "t", content = "c") and a branded string for ProcessId.
 */

// ---------------------------------------------------------------------------
// ProcessId -- branded string validated against [a-zA-Z0-9_-]{1,64}
// ---------------------------------------------------------------------------

declare const ProcessIdBrand: unique symbol;

/** Branded string type for validated process identifiers. */
export type ProcessId = string & { readonly [ProcessIdBrand]: true };

const PROCESS_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validate and return a branded ProcessId.
 * Throws if the input doesn't match `[a-zA-Z0-9_-]{1,64}`.
 */
export function validateProcessId(id: string): ProcessId {
  if (!PROCESS_ID_RE.test(id)) {
    throw new Error(`Invalid process ID: "${id}" (must match [a-zA-Z0-9_-]{1,64})`);
  }
  return id as ProcessId;
}

/**
 * Sanitize a string into a valid Axon ProcessId.
 * Replaces invalid characters with hyphens, truncates to 64 chars.
 * Valid pattern: [a-zA-Z0-9_-]{1,64}
 */
export function sanitizeProcessId(input: string): string {
  if (!input) return "unnamed";

  // Replace invalid characters with hyphens
  let sanitized = input.replace(/[^a-zA-Z0-9_-]/g, "-");

  // Remove leading/trailing hyphens
  sanitized = sanitized.replace(/^-+|-+$/g, "");

  // Collapse consecutive hyphens
  sanitized = sanitized.replace(/-{2,}/g, "-");

  // Truncate to 64 characters
  sanitized = sanitized.slice(0, 64);

  // Trim trailing hyphens that truncation may have introduced
  sanitized = sanitized.replace(/-+$/, "");

  // If empty after sanitization, use fallback
  if (!sanitized) return "unnamed";

  return sanitized;
}

// ---------------------------------------------------------------------------
// AxonError -- maps server Error responses to a proper Error subclass
// ---------------------------------------------------------------------------

export class AxonError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AxonError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// ProcessState -- serde default external tagging
// ---------------------------------------------------------------------------

/** Unit variants serialize as strings, Exited as { Exited: { exit_code } }. */
export type ProcessState =
  | "Starting"
  | "Running"
  | "Stopping"
  | { Exited: { exit_code: number | null } };

// ---------------------------------------------------------------------------
// ProcessInfo -- snapshot of a managed process
// ---------------------------------------------------------------------------

export interface ProcessInfo {
  id: ProcessId;
  command: string;
  args: string[];
  state: ProcessState;
  pid: number | null;
  started_at: number | null;
}

// ---------------------------------------------------------------------------
// OutputStream / EventType
// ---------------------------------------------------------------------------

export type OutputStream = "Stdout" | "Stderr";

export type EventType = "Spawned" | "Exited" | "OutputLine" | "PatternMatch";

// ---------------------------------------------------------------------------
// EventFilter -- optional fields for subscription filtering
// ---------------------------------------------------------------------------

export interface EventFilter {
  process_ids?: ProcessId[] | null;
  event_types?: EventType[] | null;
}

// ---------------------------------------------------------------------------
// AxonEvent -- tagged union (serde tag = "t", content = "c")
// ---------------------------------------------------------------------------

export type AxonEvent =
  | {
      t: "Spawned";
      c: { process_id: ProcessId; command: string; timestamp: number };
    }
  | {
      t: "Exited";
      c: { process_id: ProcessId; exit_code: number | null; timestamp: number };
    }
  | {
      t: "OutputLine";
      c: {
        process_id: ProcessId;
        stream: OutputStream;
        line: string;
        timestamp: number;
      };
    }
  | {
      t: "PatternMatch";
      c: {
        process_id: ProcessId;
        pattern_id: string;
        line: string;
        timestamp: number;
      };
    };

// ---------------------------------------------------------------------------
// MessageKind -- tagged union (serde tag = "t", content = "c")
// ---------------------------------------------------------------------------

export type MessageKind =
  // Requests
  | {
      t: "Spawn";
      c: {
        process_id: ProcessId;
        command: string;
        args: string[];
        env: Record<string, string> | null;
        cwd: string | null;
      };
    }
  | { t: "Kill"; c: { process_id: ProcessId; signal: number | null } }
  | { t: "List" }
  | { t: "Subscribe"; c: { filter: EventFilter } }
  | { t: "Unsubscribe"; c: { subscription_id: number } }
  | { t: "GetProcess"; c: { process_id: ProcessId } }
  | { t: "ReadBuffer"; c: { process_id: ProcessId; offset: number | null; limit: number | null } }
  | { t: "Shutdown" }
  // Responses
  | { t: "SpawnOk"; c: { process_id: ProcessId } }
  | { t: "KillOk" }
  | { t: "ListOk"; c: { processes: ProcessInfo[] } }
  | { t: "SubscribeOk"; c: { subscription_id: number } }
  | { t: "UnsubscribeOk" }
  | { t: "GetProcessOk"; c: { process: ProcessInfo } }
  | { t: "ReadBufferOk"; c: { data: string; bytes_read: number; total_written: number } }
  | { t: "ShutdownOk" }
  | { t: "Error"; c: { code: string; message: string } }
  // Push
  | { t: "Event"; c: { subscription_id: number; event: AxonEvent } };

// ---------------------------------------------------------------------------
// Message -- top-level wire envelope
// ---------------------------------------------------------------------------

export interface Message {
  id: number;
  kind: MessageKind;
}

// ---------------------------------------------------------------------------
// HandshakeMessage -- tagged union for the handshake phase
// ---------------------------------------------------------------------------

export type HandshakeMessage =
  | {
      t: "Hello";
      c: { version: string; client_name: string | null };
    }
  | {
      t: "Ok";
      c: { version: string; session_id: string };
    }
  | {
      t: "Error";
      c: { code: string; message: string };
    };
