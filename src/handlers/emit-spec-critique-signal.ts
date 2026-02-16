#!/usr/bin/env bun
/**
 * emit-spec-critique-signal.ts - Deterministic SPEC_CRITIQUE Signal Emission
 *
 * Called directly by collab.spec-critique command at key lifecycle points.
 * This gives us full control over signal timing - no dependency on hooks.
 *
 * Pattern: Matches emit-blindqa-signal.ts for consistency
 *
 * Usage:
 *   bun emit-spec-critique-signal.ts start "Starting spec analysis"
 *   bun emit-spec-critique-signal.ts pass "All HIGH issues resolved"
 *   bun emit-spec-critique-signal.ts warn "MEDIUM/LOW issues remain"
 *   bun emit-spec-critique-signal.ts fail "HIGH issues remain"
 */

import { $ } from "bun";
import { execSync } from "child_process";

// Detect repo root and use local paths
function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = getRepoRoot();
const REGISTRY_DIR = `${REPO_ROOT}/.collab/state/pipeline-registry`;

const args = process.argv.slice(2);
const [eventType, message] = args;

if (!eventType || !message) {
  console.error("Usage: bun emit-spec-critique-signal.ts <start|pass|warn|fail> <message>");
  process.exit(1);
}

// Determine ticket ID from current directory or registry
function getTicketId(): string {
  try {
    // Try to find ticket from registry files
    const files = execSync(`ls ${REGISTRY_DIR}/*.json 2>/dev/null || echo ""`, {
      encoding: "utf-8",
    }).trim();

    if (files) {
      const firstFile = files.split("\n")[0];
      const ticketId = firstFile.match(/([A-Z]+-\d+)\.json$/)?.[1];
      if (ticketId) return ticketId;
    }
  } catch {}

  return "UNKNOWN";
}

const ticketId = getTicketId();

// Map event types to signal names
const signalMap: Record<string, string> = {
  start: "SPEC_CRITIQUE_START",
  pass: "SPEC_CRITIQUE_PASS",
  warn: "SPEC_CRITIQUE_WARN",
  fail: "SPEC_CRITIQUE_FAIL",
};

const signal = signalMap[eventType];
if (!signal) {
  console.error(`Unknown event type: ${eventType}`);
  process.exit(1);
}

// Emit signal in orchestrator-compatible format
const signalOutput = `[SIGNAL:${ticketId}:${Date.now()}] ${signal} | ${message}`;
console.log(signalOutput);

// Also log to stderr for orchestrator capture
console.error(signalOutput);

process.exit(0);
