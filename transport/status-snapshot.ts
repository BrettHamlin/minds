// status-snapshot.ts — Build pipeline state snapshots for SSE delivery (BRE-397)
//
// Reads registry JSON files from .collab/state/pipeline-registry/ and derives
// pipeline state using deriveStatus/deriveDetail from status-table.ts (FR-005).
//
// Dependencies:
//   - deriveStatus, deriveDetail from src/scripts/orchestrator/commands/status-table
//     (intentional cross-directory import per FR-005 — reuse existing derivation logic)
//
// The snapshot event is ephemeral: it is sent once to a connecting client via
// ctrl.enqueue() and is NOT stored in the bus server's ring buffer. Snapshots
// are derived from current registry state (always fresh), not from event history.

import * as fs from "fs";
import * as path from "path";
import {
  deriveStatus,
  deriveDetail,
} from "../src/scripts/orchestrator/commands/status-table";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PipelineSnapshot {
  ticketId: string;
  phase: string;
  status: string;
  detail: string;
  busUrl?: string;
  startedAt?: string;
  updatedAt?: string;
  phaseHistory?: Array<{ phase: string; signal: string; ts: string }>;
  implProgress?: { current: number; total: number };
}

export interface StatusSnapshot {
  type: "snapshot";
  pipelines: PipelineSnapshot[];
  timestamp: string;
}

// ── Snapshot builder ─────────────────────────────────────────────────────────

/**
 * Build a snapshot of all active pipelines by reading registry JSON files.
 * Reuses deriveStatus/deriveDetail from status-table.ts for consistency (FR-005).
 *
 * @param registryDir - Absolute path to the pipeline registry directory
 * @returns StatusSnapshot with all active pipeline states (may be empty)
 */
export function buildSnapshot(registryDir: string): StatusSnapshot {
  const pipelines: PipelineSnapshot[] = [];

  let files: string[] = [];
  try {
    files = fs.readdirSync(registryDir).filter((f) => f.endsWith(".json"));
  } catch {
    // Registry dir missing or unreadable — return empty snapshot (FR-007)
  }

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(registryDir, file), "utf8");
      const reg = JSON.parse(raw) as Record<string, unknown>;

      const phasePlan = reg.implement_phase_plan as
        | { current_impl_phase: number; total_phases: number }
        | undefined;

      pipelines.push({
        ticketId:
          (reg.ticket_id as string) || file.replace(".json", ""),
        phase: (reg.current_step as string) || "unknown",
        status: deriveStatus(reg),
        detail: deriveDetail(reg),
        busUrl: reg.bus_url as string | undefined,
        startedAt: reg.started_at as string | undefined,
        updatedAt: reg.updated_at as string | undefined,
        phaseHistory: reg.phase_history as
          | Array<{ phase: string; signal: string; ts: string }>
          | undefined,
        implProgress: phasePlan
          ? {
              current: phasePlan.current_impl_phase,
              total: phasePlan.total_phases,
            }
          : undefined,
      });
    } catch {
      // Corrupt or unparseable file — skip (FR-007)
    }
  }

  return {
    type: "snapshot",
    pipelines,
    timestamp: new Date().toISOString(),
  };
}

// ── SSE formatting ───────────────────────────────────────────────────────────

/**
 * Format a StatusSnapshot as an SSE event with the `event: snapshot` field.
 * Uses a distinct event type so clients can listen via
 * EventSource.addEventListener("snapshot", ...) per FR-008.
 *
 * @param snapshot - The snapshot to format
 * @param seq - The SSE event ID (from global seqCounter)
 * @returns Uint8Array encoded SSE event
 */
export function formatSnapshotEvent(
  snapshot: StatusSnapshot,
  seq: number,
): Uint8Array {
  const data = JSON.stringify(snapshot);
  return new TextEncoder().encode(
    `event: snapshot\nid: ${seq}\ndata: ${data}\n\n`,
  );
}
