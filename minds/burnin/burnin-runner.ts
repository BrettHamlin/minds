#!/usr/bin/env bun
/**
 * burnin-runner.ts — Deterministic burn-in loop.
 *
 * Exit codes:
 *   0 — all tickets completed successfully
 *   1 — fatal error (can't recover)
 *   2 — needs fix: ticket failed, diagnosis in state file
 *   3 — needs escalation: multiple retries for same category
 */

import { parseArgs } from "util";
import { resolve } from "path";
import {
  createSession,
  loadSession,
  saveSession,
  advanceTicket,
  recordAttempt,
  consecutiveSameCategoryCount,
  type BurnInState,
} from "./lib/fix-tracker.ts";
import {
  createTargetWindow,
  launchClaudeCode,
  sendCommand,
  captureAllPanes,
} from "./lib/target-session.ts";
import {
  pollForCompletion,
  TASKS_PATTERNS,
  IMPLEMENT_PATTERNS,
  type PollOptions,
} from "./lib/poller.ts";
import { diagnoseFailure } from "./lib/diagnosis.ts";

// ── CLI Parsing ────────────────────────────────────────────────────────

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    tickets: { type: "string" },
    target: { type: "string" },
    session: { type: "string" },
    "timeout-tasks": { type: "string", default: "600" },
    "timeout-implement": { type: "string", default: "3600" },
    "poll-interval": { type: "string", default: "10" },
    "stall-threshold": { type: "string", default: "180" },
  },
});

if (!values.target) {
  console.error("Usage: burnin-runner.ts --tickets BRE-1,BRE-2 --target /path/to/repo [--session <id>]");
  process.exit(1);
}

const targetRepo = resolve(values.target);
const gravitasRoot = resolve(import.meta.dir, "../..");
const ticketIds = values.tickets?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
const timeoutTasksMs = parseInt(values["timeout-tasks"]!) * 1000;
const timeoutImplementMs = parseInt(values["timeout-implement"]!) * 1000;
const pollIntervalMs = parseInt(values["poll-interval"]!) * 1000;
const stallThresholdMs = parseInt(values["stall-threshold"]!) * 1000;
const ESCALATION_THRESHOLD = 3;

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<never> {
  // Load or create session
  let state: BurnInState;
  if (values.session) {
    const loaded = loadSession(gravitasRoot, values.session);
    if (!loaded) {
      console.error(`Session ${values.session} not found`);
      process.exit(1);
    }
    state = loaded;
    console.log(`Resumed session ${state.sessionId}`);
  } else {
    if (ticketIds.length === 0) {
      console.error("--tickets required for new session");
      process.exit(1);
    }
    state = createSession(gravitasRoot, targetRepo, ticketIds);
    console.log(`Created session ${state.sessionId}`);
  }

  // Process each pending ticket
  for (const ticket of state.tickets) {
    if (ticket.phase === "done") {
      console.log(`[${ticket.ticketId}] Already done, skipping`);
      continue;
    }

    const windowName = `burnin-${ticket.ticketId}`;
    console.log(`\n[${ticket.ticketId}] Starting (phase: ${ticket.phase})`);

    // Create target window and launch Claude Code
    let paneId: string;
    try {
      paneId = await createTargetWindow(windowName, targetRepo);
      console.log(`[${ticket.ticketId}] Created window ${windowName} (pane: ${paneId})`);
      await launchClaudeCode(paneId, targetRepo, gravitasRoot);
      console.log(`[${ticket.ticketId}] Claude Code launched`);
    } catch (err) {
      console.error(`[${ticket.ticketId}] Fatal: failed to create target session: ${err}`);
      saveSession(gravitasRoot, state);
      process.exit(1);
    }

    // ── Tasks Phase ──────────────────────────────────────────────────

    if (ticket.phase === "pending" || ticket.phase === "tasks") {
      state = advanceTicket(state, ticket.ticketId, "tasks");
      saveSession(gravitasRoot, state);

      console.log(`[${ticket.ticketId}] Running /minds.tasks`);
      await sendCommand(paneId, `/minds.tasks ${ticket.ticketId}`, gravitasRoot);

      const pollOpts: PollOptions = {
        timeoutMs: timeoutTasksMs,
        pollIntervalMs,
        scrollback: 500,
        stallThresholdMs,
      };
      const result = await pollForCompletion(paneId, TASKS_PATTERNS, pollOpts, gravitasRoot);

      if (result.status === "success") {
        console.log(`[${ticket.ticketId}] Tasks phase succeeded`);
        state = advanceTicket(state, ticket.ticketId, "implement");
        saveSession(gravitasRoot, state);
      } else {
        console.log(`[${ticket.ticketId}] Tasks phase failed (${result.status})`);
        const allOutputs = await captureAllPanes(paneId, gravitasRoot);
        const diagnosis = diagnoseFailure(result.output, allOutputs);
        state = recordAttempt(state, ticket.ticketId, {
          phase: "tasks",
          diagnosis,
          fixDescription: "",
          outcome: "failure",
        });
        saveSession(gravitasRoot, state);

        const sameCount = consecutiveSameCategoryCount(state, ticket.ticketId, diagnosis.category);
        if (sameCount >= ESCALATION_THRESHOLD) {
          console.log(`[${ticket.ticketId}] Escalation needed (${sameCount}x ${diagnosis.category})`);
          process.exit(3);
        }
        console.log(`[${ticket.ticketId}] Fix needed: ${diagnosis.category} — ${diagnosis.summary.slice(0, 100)}`);
        process.exit(2);
      }
    }

    // ── Implement Phase ──────────────────────────────────────────────

    if (ticket.phase === "implement") {
      console.log(`[${ticket.ticketId}] Running /minds.implement`);
      await sendCommand(paneId, `/minds.implement ${ticket.ticketId}`, gravitasRoot);

      // Implement stall threshold is 10x tasks: drones work in separate panes,
      // so the main pane can be silent for 10+ minutes while drones are active.
      const implementStallMs = Math.max(stallThresholdMs * 10, 20 * 60 * 1000); // min 20 min
      const pollOpts: PollOptions = {
        timeoutMs: timeoutImplementMs,
        pollIntervalMs,
        scrollback: 1000,
        stallThresholdMs: implementStallMs,
      };
      const result = await pollForCompletion(paneId, IMPLEMENT_PATTERNS, pollOpts, gravitasRoot);

      if (result.status === "success") {
        console.log(`[${ticket.ticketId}] Implement phase succeeded`);
        state = advanceTicket(state, ticket.ticketId, "done");
        saveSession(gravitasRoot, state);
      } else {
        console.log(`[${ticket.ticketId}] Implement phase failed (${result.status})`);
        const allOutputs = await captureAllPanes(paneId, gravitasRoot);
        const diagnosis = diagnoseFailure(result.output, allOutputs);
        state = recordAttempt(state, ticket.ticketId, {
          phase: "implement",
          diagnosis,
          fixDescription: "",
          outcome: "failure",
        });
        saveSession(gravitasRoot, state);

        const sameCount = consecutiveSameCategoryCount(state, ticket.ticketId, diagnosis.category);
        if (sameCount >= ESCALATION_THRESHOLD) {
          console.log(`[${ticket.ticketId}] Escalation needed (${sameCount}x ${diagnosis.category})`);
          process.exit(3);
        }
        console.log(`[${ticket.ticketId}] Fix needed: ${diagnosis.category} — ${diagnosis.summary.slice(0, 100)}`);
        process.exit(2);
      }
    }
  }

  // All tickets done
  console.log("\nAll tickets completed successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
