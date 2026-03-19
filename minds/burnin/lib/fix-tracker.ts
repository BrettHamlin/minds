/**
 * fix-tracker.ts — State management for burn-in sessions.
 * Tracks ticket progress, attempted fixes, and outcomes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ── Types ──────────────────────────────────────────────────────────────

export interface BurnInState {
  sessionId: string;
  startedAt: string;
  targetRepo: string;
  tickets: TicketState[];
}

export interface TicketState {
  ticketId: string;
  phase: "pending" | "tasks" | "implement" | "done";
  attempts: AttemptRecord[];
}

export interface AttemptRecord {
  attemptNumber: number;
  phase: "tasks" | "implement";
  diagnosis: Diagnosis;
  fixDescription: string;
  fixCommit?: string;
  outcome: "success" | "failure" | "same_error" | "new_error";
  timestamp: string;
}

export interface Diagnosis {
  category:
    | "task_lint"
    | "task_generation"
    | "drone_stall"
    | "drone_crash"
    | "merge_conflict"
    | "boundary_violation"
    | "contract_error"
    | "bus_failure"
    | "timeout"
    | "unknown";
  summary: string;
  rawOutput: string;
  allPaneOutputs: Record<string, string>;
  suggestedFiles: string[];
}

// ── Paths ──────────────────────────────────────────────────────────────

function stateDir(gravitasRoot: string): string {
  return join(gravitasRoot, ".minds", "state");
}

function statePath(gravitasRoot: string, sessionId: string): string {
  return join(stateDir(gravitasRoot), `burnin-${sessionId}.json`);
}

// ── Functions ──────────────────────────────────────────────────────────

export function createSession(
  gravitasRoot: string,
  targetRepo: string,
  ticketIds: string[],
): BurnInState {
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const state: BurnInState = {
    sessionId,
    startedAt: new Date().toISOString(),
    targetRepo,
    tickets: ticketIds.map((ticketId) => ({
      ticketId,
      phase: "pending",
      attempts: [],
    })),
  };

  const dir = stateDir(gravitasRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(gravitasRoot, sessionId), JSON.stringify(state, null, 2));
  return state;
}

export function loadSession(gravitasRoot: string, sessionId: string): BurnInState | null {
  const p = statePath(gravitasRoot, sessionId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function saveSession(gravitasRoot: string, state: BurnInState): void {
  const dir = stateDir(gravitasRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(gravitasRoot, state.sessionId), JSON.stringify(state, null, 2));
}

export function getTicketState(state: BurnInState, ticketId: string): TicketState | undefined {
  return state.tickets.find((t) => t.ticketId === ticketId);
}

export function recordAttempt(
  state: BurnInState,
  ticketId: string,
  attempt: Omit<AttemptRecord, "attemptNumber" | "timestamp">,
): BurnInState {
  const ticket = state.tickets.find((t) => t.ticketId === ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} not found in session`);

  const record: AttemptRecord = {
    ...attempt,
    attemptNumber: ticket.attempts.length + 1,
    timestamp: new Date().toISOString(),
  };
  ticket.attempts.push(record);
  return state;
}

export function advanceTicket(
  state: BurnInState,
  ticketId: string,
  toPhase: TicketState["phase"],
): BurnInState {
  const ticket = state.tickets.find((t) => t.ticketId === ticketId);
  if (!ticket) throw new Error(`Ticket ${ticketId} not found in session`);
  ticket.phase = toPhase;
  return state;
}

/**
 * Count consecutive attempts with the same diagnosis category for a ticket.
 */
export function consecutiveSameCategoryCount(
  state: BurnInState,
  ticketId: string,
  category: Diagnosis["category"],
): number {
  const ticket = state.tickets.find((t) => t.ticketId === ticketId);
  if (!ticket) return 0;

  let count = 0;
  for (let i = ticket.attempts.length - 1; i >= 0; i--) {
    if (ticket.attempts[i].diagnosis.category === category) count++;
    else break;
  }
  return count;
}
