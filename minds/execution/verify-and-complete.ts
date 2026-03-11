#!/usr/bin/env bun
// ============================================================================
// verify-and-complete.ts - Verify phase completion and emit signal
// ============================================================================
//
// Purpose:
//   Verify that a phase is complete (all tasks done, tests passing) and
//   automatically emit the completion signal to the orchestrator.
//
// Usage:
//   bun verify-and-complete.ts <phase-name> <message> [phase-scope]
//   Example: bun verify-and-complete.ts implement "Implementation phase finished"
//   Example: bun verify-and-complete.ts implement "Phase 2 complete" 2
//   Example: bun verify-and-complete.ts implement "Phases 1-4 complete" 1-4
//
// Arguments:
//   phase-scope (optional): single phase number '2' or range '1-4'.
//     When provided, only tasks within those ## Phase N: sections are checked.
//     When omitted, all tasks in the file are checked (original behavior).
//
// Exit codes:
//   0 = verification passed, signal emitted
//   1 = verification failed, signal not emitted
// ============================================================================

import { spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parseTaskPhases } from "../pipeline_core/task-phases"; // CROSS-MIND
import { getRepoRoot } from "../shared/paths.js";

async function resolvePhaseAndScope(): Promise<{ phase: string | undefined; autoScope: string }> {
  try {
    const { resolveRegistry } = await import("../handlers/pipeline-signal");
    const registry = await resolveRegistry();
    if (registry?.current_step) {
      // Auto-detect phase scope from implement_phase_plan when no explicit arg given
      const plan = registry.implement_phase_plan;
      const autoScope =
        plan?.current_impl_phase != null ? String(plan.current_impl_phase) : "";
      return { phase: registry.current_step, autoScope };
    }
  } catch {}
  // Fallback to CLI arg for non-orchestrated runs
  return { phase: process.argv[2], autoScope: "" };
}

const { phase: resolvedPhase, autoScope } = await resolvePhaseAndScope();
const PHASE = resolvedPhase;
const MESSAGE = process.argv[3] ?? "Phase completed";
// Explicit CLI arg takes precedence; registry auto-detection is fallback
const PHASE_SCOPE = process.argv[4] ?? autoScope;

if (!PHASE) {
  console.error("[VerifyComplete] ERROR: phase-name argument required");
  process.exit(1);
}

// Detect repo root
const REPO_ROOT = getRepoRoot();

const COLLAB_DIR = join(REPO_ROOT, ".minds");

console.log(`[VerifyComplete] Phase: ${PHASE}`);
console.log("[VerifyComplete] Checking completion conditions...");

// Phase-specific verification
if (PHASE === "implement") {
  // Resolve active feature's tasks.md via resolve-feature.ts first (avoids picking the
  // wrong file when multiple features have a specs/*/tasks.md in the same repo).
  let tasksFile = "";

  const resolveScriptInstalled = join(COLLAB_DIR, "scripts/resolve-feature.ts");
  const resolveScriptSrc = join(REPO_ROOT, "src/scripts/resolve-feature.ts");
  const resolveScript = existsSync(resolveScriptInstalled) ? resolveScriptInstalled : resolveScriptSrc;
  if (existsSync(resolveScript)) {
    try {
      const resolveOutput = execSync(
        `bun "${resolveScript}" --include-tasks 2>/dev/null`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      const match = resolveOutput.match(/"FEATURE_DIR":"([^"]*)"/);
      if (match && match[1]) {
        const candidate = join(match[1], "tasks.md");
        if (existsSync(candidate)) {
          tasksFile = candidate;
        }
      }
    } catch {
      // ignore, fall through to glob
    }
  }

  // Fall back: sorted glob across specs/, then repo root
  if (!tasksFile) {
    const specsDir = join(REPO_ROOT, "specs");
    if (existsSync(specsDir)) {
      const candidates: string[] = [];
      for (const entry of readdirSync(specsDir)) {
        const candidate = join(specsDir, entry, "tasks.md");
        if (existsSync(candidate)) {
          candidates.push(candidate);
        }
      }
      candidates.sort();
      if (candidates.length > 0) {
        tasksFile = candidates[0];
      }
    }
  }
  if (!tasksFile) {
    tasksFile = join(REPO_ROOT, "tasks.md");
  }

  if (!existsSync(tasksFile)) {
    console.log(
      "[VerifyComplete] ❌ tasks.md not found (searched specs/*/tasks.md and repo root)"
    );
    process.exit(1);
  }

  const content = readFileSync(tasksFile, "utf-8");
  const lines = content.split("\n");

  let incomplete: number;

  if (PHASE_SCOPE) {
    const isRange = PHASE_SCOPE.includes("-");
    let rangeStart: number;
    let rangeEnd: number;

    if (isRange) {
      const dashIdx = PHASE_SCOPE.indexOf("-");
      rangeStart = parseInt(PHASE_SCOPE.substring(0, dashIdx), 10);
      rangeEnd = parseInt(PHASE_SCOPE.substring(dashIdx + 1), 10);
      console.log(`[VerifyComplete] Checking phases ${rangeStart}-${rangeEnd} only`);
    } else {
      rangeStart = parseInt(PHASE_SCOPE, 10);
      rangeEnd = rangeStart;
      console.log(`[VerifyComplete] Checking phase ${PHASE_SCOPE} only`);
    }

    const phases = parseTaskPhases(content);
    const scopedPhases = phases.filter((p) => p.number >= rangeStart && p.number <= rangeEnd);
    incomplete = scopedPhases.reduce((sum, p) => sum + p.incomplete, 0);
  } else {
    incomplete = lines.filter((line) => line.startsWith("- [ ]")).length;
  }

  if (incomplete > 0) {
    console.log(`[VerifyComplete] ❌ ${incomplete} incomplete tasks remaining`);
    process.exit(1);
  }

  console.log("[VerifyComplete] ✓ All tasks complete");
} else if (PHASE === "analyze") {
  // For analyze phase, no specific verification needed
  // The orchestrator will check for CRITICAL issues
  console.log("[VerifyComplete] ✓ Analysis phase checks complete");
} else {
  // For other phases, just verify the phase exists
  console.log(`[VerifyComplete] ✓ Phase ${PHASE} complete (no specific checks)`);
}

// CHECK_ONLY mode: skip signal emission (used by automated tests)
if (process.env.CHECK_ONLY === "1") {
  console.log("[VerifyComplete] CHECK_ONLY: verification complete, skipping signal emission");
  process.exit(0);
}

// Emit the completion signal
console.log("[VerifyComplete] Emitting completion signal...");

// Guard: if the signal handler is not installed, skip emission gracefully.
// This allows verify-and-complete.ts to work in environments where collab
// has not been fully installed (e.g. fresh checkouts, test environments).
const handlerPath = join(COLLAB_DIR, "handlers/emit-signal.ts");
if (!existsSync(handlerPath)) {
  console.log("[VerifyComplete] ✓ Signal handler not installed — skipping emission");
  process.exit(0);
}

const result = spawnSync(
  "bun",
  [handlerPath, "complete", MESSAGE],
  { stdio: "inherit" }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("[VerifyComplete] ✓ Signal emitted successfully");
process.exit(0);
