#!/usr/bin/env bun

/**
 * status-table.ts - Render status table from all registries
 *
 * Scans all ticket registry files and renders a formatted ASCII table
 * showing the current state of all pipeline tickets.
 *
 * Usage:
 *   bun commands/status-table.ts
 *
 * Output (stdout):
 *   ASCII table with columns: Ticket, Phase, Status, Gate, Detail
 *
 * Exit codes:
 *   0 = success (even if no registries found — renders empty table)
 *   3 = file error (registry directory missing)
 */

import * as fs from "fs";
import * as path from "path";
import {
  getRepoRoot,
  readJsonFile,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";

// ---------------------------------------------------------------------------
// Column widths
// ---------------------------------------------------------------------------

const COL_TICKET = 13;
const COL_PHASE = 10;
const COL_STATUS = 14;
const COL_GATE = 17;
const COL_DETAIL = 30;
const COL_REPO = 10;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pad(str: string, width: number): string {
  return str.substring(0, width).padEnd(width);
}

function hrLine(sep: string, showRepo: boolean): string {
  const repoSegment = showRepo ? sep + "-".repeat(COL_REPO + 2) : "";
  return (
    "+" +
    "-".repeat(COL_TICKET + 2) +
    sep +
    "-".repeat(COL_PHASE + 2) +
    sep +
    "-".repeat(COL_STATUS + 2) +
    sep +
    "-".repeat(COL_GATE + 2) +
    sep +
    "-".repeat(COL_DETAIL + 2) +
    repoSegment +
    "+"
  );
}

function row(ticket: string, phase: string, status: string, gate: string, detail: string, repo?: string): string {
  const repoSegment = repo !== undefined ? ` | ${pad(repo, COL_REPO)}` : "";
  return (
    `| ${pad(ticket, COL_TICKET)} | ${pad(phase, COL_PHASE)} | ` +
    `${pad(status, COL_STATUS)} | ${pad(gate, COL_GATE)} | ${pad(detail, COL_DETAIL)}${repoSegment} |`
  );
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

export function deriveStatus(reg: Record<string, unknown>): string {
  const status = reg.status as string | undefined;
  if (status) return status;

  const lastSignal = reg.last_signal as string | undefined;
  if (!lastSignal) return "running";
  if (lastSignal.endsWith("_COMPLETE")) return "completed";
  if (lastSignal.endsWith("_ERROR")) return "error";
  if (lastSignal.endsWith("_FAILED")) return "failed";
  if (lastSignal.endsWith("_WAITING")) return "waiting";
  if (lastSignal.endsWith("_QUESTION")) return "needs_input";
  return "running";
}

export function deriveGate(
  reg: Record<string, unknown>,
  groupsDir: string
): string {
  const groupId = reg.group_id as string | undefined;
  if (!groupId) return "--";

  const groupFile = path.join(groupsDir, `${groupId}.json`);
  const group = readJsonFile(groupFile);
  if (!group) return "group:missing";

  const tickets = (group.tickets as string[]) || [];
  const readyPhases = new Set(["implement", "blindqa", "done"]);

  // Check registry for each ticket in group
  const registryDir = path.dirname(groupFile).replace("/pipeline-groups", "/pipeline-registry");
  for (const ticket of tickets) {
    const ticketReg = readJsonFile(path.join(registryDir, `${ticket}.json`));
    if (!ticketReg) return "group:waiting";
    const step = ticketReg.current_step as string | undefined;
    if (!step || !readyPhases.has(step)) return "group:waiting";
  }

  return "group:ready";
}

export function deriveDetail(reg: Record<string, unknown>): string {
  const status = reg.status as string | undefined;
  if (status === "held") {
    const waitingFor = (reg.waiting_for as string) || "unknown";
    return `held | waiting for ${waitingFor}`.substring(0, COL_DETAIL);
  }

  // Show phased implementation progress when a plan is active
  const currentStep = reg.current_step as string | undefined;
  const phasePlan = reg.implement_phase_plan as
    | { total_phases: number; current_impl_phase: number }
    | undefined;
  if (currentStep === "implement" && phasePlan) {
    return `impl ${phasePlan.current_impl_phase}/${phasePlan.total_phases}`.substring(0, COL_DETAIL);
  }

  const lastSignal = reg.last_signal as string | undefined;
  const lastSignalAt = reg.last_signal_at as string | undefined;
  if (lastSignal && lastSignalAt) {
    return `${lastSignal} @ ${lastSignalAt}`.substring(0, COL_DETAIL);
  }

  const step = (reg.current_step as string) || "unknown";
  return `Working on ${step} phase`.substring(0, COL_DETAIL);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface RenderTableOptions {
  /** If provided and file exists, a repo_id column is added */
  multiRepoConfigPath?: string;
}

export function renderTable(
  registryDir: string,
  groupsDir: string,
  options?: RenderTableOptions
): string {
  const showRepo = !!(
    options?.multiRepoConfigPath && fs.existsSync(options.multiRepoConfigPath)
  );

  const lines: string[] = [];
  const hrTop = hrLine("+", showRepo);
  const hrMid = hrLine("|", showRepo);

  lines.push(hrTop);
  lines.push(row("Ticket", "Phase", "Status", "Gate", "Detail", showRepo ? "Repo" : undefined));
  lines.push(hrMid);

  let files: string[] = [];
  try {
    files = fs.readdirSync(registryDir).filter((f) => f.endsWith(".json"));
  } catch {
    // Registry dir not found — will emit empty table
  }

  if (files.length === 0) {
    lines.push(row("(none)", "--", "--", "--", "No active tickets", showRepo ? "--" : undefined));
  } else {
    for (const file of files) {
      const reg = readJsonFile(path.join(registryDir, file));
      if (!reg) continue;

      const ticket = (reg.ticket_id as string) || "unknown";
      const phase = (reg.current_step as string) || "unknown";
      const status = deriveStatus(reg);
      const gate = deriveGate(reg, groupsDir);
      const detail = deriveDetail(reg);
      const repoId = showRepo ? ((reg.repo_id as string) || "--") : undefined;

      lines.push(row(ticket, phase, status, gate, detail, repoId));
    }
  }

  lines.push(hrTop);
  return lines.join("\n");
}

function main(): void {
  try {
    const repoRoot = getRepoRoot();
    const registryDir = `${repoRoot}/.collab/state/pipeline-registry`;
    const groupsDir = `${repoRoot}/.collab/state/pipeline-groups`;
    const multiRepoConfigPath = `${repoRoot}/.collab/config/multi-repo.json`;

    // Ensure dirs exist
    fs.mkdirSync(registryDir, { recursive: true });
    fs.mkdirSync(groupsDir, { recursive: true });

    console.log(renderTable(registryDir, groupsDir, { multiRepoConfigPath }));
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
