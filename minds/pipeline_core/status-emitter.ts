/**
 * StatusEmitter — publishes status events to the bus on registry writes.
 *
 * Integrated into writeJsonAtomic() so every registry state change is
 * automatically published to the bus `status` channel. Fire-and-forget:
 * never throws, never blocks the calling script.
 */

import * as fs from "fs";
import * as path from "path";
import { getRepoRoot } from "./repo";

// ── Types ────────────────────────────────────────────────────────────────────

export type StatusEventType =
  | "registry_created"
  | "phase_changed"
  | "status_changed"
  | "hold_changed"
  | "registry_updated";

export interface StatusEvent {
  ticketId: string;
  eventType: StatusEventType;
  changedFields: Record<string, { old: unknown; new: unknown }>;
  snapshot: Record<string, unknown>;
  timestamp: string;
}

// ── Classification ───────────────────────────────────────────────────────────

export function classifyEvent(
  previous: Record<string, unknown> | null,
  current: Record<string, unknown>,
): StatusEventType {
  if (!previous) return "registry_created";
  if (previous.current_step !== current.current_step) return "phase_changed";
  if (previous.status !== current.status) return "status_changed";
  if (previous.held_at !== current.held_at || previous.waiting_for !== current.waiting_for)
    return "hold_changed";
  return "registry_updated";
}

// ── Diff Computation ─────────────────────────────────────────────────────────

export function computeChangedFields(
  previous: Record<string, unknown> | null,
  current: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> {
  const diff: Record<string, { old: unknown; new: unknown }> = {};

  if (!previous) {
    // New creation — all fields are new
    for (const key of Object.keys(current)) {
      diff[key] = { old: null, new: current[key] };
    }
    return diff;
  }

  // Check all keys in current for changes
  const allKeys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  for (const key of allKeys) {
    const oldVal = previous[key];
    const newVal = current[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = { old: oldVal ?? null, new: newVal ?? null };
    }
  }

  return diff;
}

// ── Bus Discovery ────────────────────────────────────────────────────────────

export function discoverBusUrl(): string | null {
  try {
    const portFile = path.join(getRepoRoot(), ".minds", "bus-port");
    if (!fs.existsSync(portFile)) return null;
    const content = fs.readFileSync(portFile, "utf-8").trim();
    const port = parseInt(content, 10);
    if (isNaN(port)) return null;
    return `http://localhost:${port}`;
  } catch {
    return null;
  }
}

// ── Emission ─────────────────────────────────────────────────────────────────

export function emitStatusEvent(
  filePath: string,
  previous: Record<string, unknown> | null,
  current: Record<string, unknown>,
): void {
  try {
    const busUrl = discoverBusUrl();
    if (!busUrl) return;

    const eventType = classifyEvent(previous, current);
    const changedFields = computeChangedFields(previous, current);
    const ticketId = current.ticket_id as string;

    const statusEvent: StatusEvent = {
      ticketId,
      eventType,
      changedFields,
      snapshot: current,
      timestamp: new Date().toISOString(),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "status",
        from: "status-emitter",
        type: eventType,
        payload: statusEvent,
      }),
      signal: controller.signal,
    })
      .then(() => clearTimeout(timeout))
      .catch((err: Error) => {
        clearTimeout(timeout);
        console.error(`[StatusEmitter] ${err.message}`);
      });
  } catch (err: unknown) {
    console.error(`[StatusEmitter] ${(err as Error).message}`);
  }
}
