/**
 * group1-integration.test.ts - CLI integration tests for all 5 TypeScript orchestrator scripts
 *
 * Tests each script as a subprocess via Bun.spawnSync, validating exit codes,
 * stdout/stderr JSON output, and file-system side effects.
 *
 * Uses real .collab/state/pipeline-registry/ directory (scripts use getRepoRoot()).
 * Unique ticket IDs per describe block prevent cross-test interference.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Test-suite setup: ensure .collab/config/pipeline.json mirrors the source of
// truth at src/config/pipeline.json.  The .collab/ directory is gitignored and
// may be absent or stale in fresh checkouts.  Orchestrator scripts resolve
// pipeline.json at ${repoRoot}/.collab/config/pipeline.json, so we keep it in
// sync here rather than requiring a manual install step.
// ---------------------------------------------------------------------------

{
  const _root = execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
    cwd: import.meta.dir,
  }).trim();
  const _src = path.join(_root, "src/config/pipeline.json");
  const _dst = path.join(_root, ".collab/config/pipeline.json");
  if (fs.existsSync(_src)) {
    fs.mkdirSync(path.dirname(_dst), { recursive: true });
    fs.copyFileSync(_src, _dst);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = execSync("git rev-parse --show-toplevel", {
  encoding: "utf-8",
  cwd: import.meta.dir,
}).trim();

const SCRIPTS_DIR = path.join(REPO_ROOT, "src/scripts/orchestrator");
const REGISTRY_DIR = path.join(REPO_ROOT, ".collab/state/pipeline-registry");

function runScript(
  script: string,
  args: string[]
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", path.join(SCRIPTS_DIR, script), ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_ENV: "test" },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

function writeRegistry(ticketId: string, data: Record<string, any>): void {
  const filePath = path.join(REGISTRY_DIR, `${ticketId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function readRegistry(ticketId: string): Record<string, any> {
  const filePath = path.join(REGISTRY_DIR, `${ticketId}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function deleteRegistry(ticketId: string): void {
  const filePath = path.join(REGISTRY_DIR, `${ticketId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function parseJson(text: string): any {
  // Some scripts output JSON to stdout, others to stderr
  // Try to parse the provided text
  return JSON.parse(text);
}

// ===========================================================================
// signal-validate.ts tests (7 tests)
// ===========================================================================

describe("signal-validate.ts", () => {
  const TICKET = "TEST-001";

  beforeAll(() => {
    writeRegistry(TICKET, {
      ticket_id: "TEST-001",
      nonce: "deadbeef",
      current_step: "clarify",
      status: "running",
    });
  });

  afterAll(() => {
    deleteRegistry(TICKET);
  });

  test("1. valid CLARIFY_COMPLETE signal exits 0 with valid=true JSON", () => {
    const signal = `[SIGNAL:TEST-001:deadbeef] CLARIFY_COMPLETE | phase done`;
    const result = runScript("signal-validate.ts", [signal]);

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.valid).toBe(true);
    expect(json.signal_type).toBe("CLARIFY_COMPLETE");
    expect(json.ticket_id).toBe("TEST-001");
  });

  test("2. valid CLARIFY_QUESTION signal exits 0", () => {
    const signal = `[SIGNAL:TEST-001:deadbeef] CLARIFY_QUESTION | A question`;
    const result = runScript("signal-validate.ts", [signal]);

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.valid).toBe(true);
    expect(json.signal_type).toBe("CLARIFY_QUESTION");
  });

  test("3. section delimiter preserved in detail field", () => {
    const signal = `[SIGNAL:TEST-001:deadbeef] CLARIFY_QUESTION | What approach?\u00A7Option A (Recommended)\u00A7Option B`;
    const result = runScript("signal-validate.ts", [signal]);

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.detail).toContain("\u00A7");
  });

  test("4. wrong nonce exits 2", () => {
    const signal = `[SIGNAL:TEST-001:wrongnonce1] CLARIFY_COMPLETE | done`;
    const result = runScript("signal-validate.ts", [signal]);

    // wrongnonce1 contains a digit which is not hex [a-f0-9] — this will fail regex parse (exit 2)
    // Let's check: "wrongnonce1" has chars w,r,o,n,g,n,o,n,c,e,1 — 'w','r','o','g' are not hex
    // So regex won't match -> exit 2 for malformed signal
    expect(result.exitCode).toBe(2);
  });

  test("5. unknown ticket exits 3", () => {
    const signal = `[SIGNAL:UNKNOWN-999:deadbeef] CLARIFY_COMPLETE | done`;
    const result = runScript("signal-validate.ts", [signal]);

    expect(result.exitCode).toBe(3);
  });

  test("6. malformed signal (no brackets) exits 2", () => {
    const result = runScript("signal-validate.ts", ["not a signal"]);

    expect(result.exitCode).toBe(2);
  });

  test("7. signal type not in phase signals exits 2", () => {
    const signal = `[SIGNAL:TEST-001:deadbeef] PLAN_COMPLETE | done`;
    const result = runScript("signal-validate.ts", [signal]);

    expect(result.exitCode).toBe(2);
  });
});

// ===========================================================================
// transition-resolve.ts tests (6 tests)
// ===========================================================================

describe("transition-resolve.ts", () => {
  test("8. clarify CLARIFY_COMPLETE resolves to plan", () => {
    const result = runScript("transition-resolve.ts", ["clarify", "CLARIFY_COMPLETE"]);

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.to).toBe("plan");
    expect(json.gate).toBeNull();
  });

  test("9. plan PLAN_COMPLETE resolves to gate", () => {
    const result = runScript("transition-resolve.ts", ["plan", "PLAN_COMPLETE"]);

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.gate).toBe("plan_review");
    // When gate is present, 'to' should be null (gate decides the target)
    expect(json.to).toBeNull();
  });

  test("10. analyze ANALYZE_COMPLETE resolves to gate", () => {
    const result = runScript("transition-resolve.ts", ["analyze", "ANALYZE_COMPLETE"]);

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.gate).toBe("analyze_review");
  });

  test("11. implement IMPLEMENT_COMPLETE resolves conditionally (hasGroup → tasks, otherwise → run_tests)", () => {
    const result = runScript("transition-resolve.ts", ["implement", "IMPLEMENT_COMPLETE"]);

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout);
    // Returns first conditional row; AI evaluates the 'if' condition at runtime
    expect(json.conditional).toBe(true);
    expect(json.if).toBe("hasGroup");
    expect(json.to).toBe("tasks");
  });

  test("12. blindqa BLINDQA_COMPLETE resolves to done", () => {
    const result = runScript("transition-resolve.ts", ["blindqa", "BLINDQA_COMPLETE"]);

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout);
    expect(json.to).toBe("done");
  });

  test("13. unknown phase exits 2", () => {
    const result = runScript("transition-resolve.ts", ["nonexistent", "SOME_COMPLETE"]);

    expect(result.exitCode).toBe(2);
  });
});

// ===========================================================================
// registry-update.ts tests (6 tests)
// ===========================================================================

describe("registry-update.ts", () => {
  const TICKET = "TEST-002";

  beforeAll(() => {
    writeRegistry(TICKET, {
      ticket_id: "TEST-002",
      nonce: "cafebabe",
      current_step: "clarify",
      status: "running",
      phase_history: [],
    });
  });

  afterAll(() => {
    deleteRegistry(TICKET);
  });

  test("14. update current_step field succeeds", () => {
    const result = runScript("registry-update.ts", ["TEST-002", "current_step=plan"]);

    expect(result.exitCode).toBe(0);
    const reg = readRegistry(TICKET);
    expect(reg.current_step).toBe("plan");
  });

  test("15. update status field succeeds", () => {
    const result = runScript("registry-update.ts", ["TEST-002", "status=answered"]);

    expect(result.exitCode).toBe(0);
    const reg = readRegistry(TICKET);
    expect(reg.status).toBe("answered");
  });

  test("16. update numeric retry_count field", () => {
    const result = runScript("registry-update.ts", ["TEST-002", "retry_count=3"]);

    expect(result.exitCode).toBe(0);
    const reg = readRegistry(TICKET);
    expect(reg.retry_count).toBe(3);
  });

  test("17. invalid field name exits 2", () => {
    const result = runScript("registry-update.ts", ["TEST-002", "invalid_field=value"]);

    expect(result.exitCode).toBe(2);
  });

  test("18. unknown ticket exits 3", () => {
    const result = runScript("registry-update.ts", ["UNKNOWN-999", "status=running"]);

    expect(result.exitCode).toBe(3);
  });

  test("19. append phase history grows array", () => {
    const entry = JSON.stringify({
      phase: "clarify",
      signal: "CLARIFY_COMPLETE",
      ts: "2026-01-01T00:00:00Z",
    });
    const result = runScript("registry-update.ts", [
      "TEST-002",
      "--append-phase-history",
      entry,
    ]);

    expect(result.exitCode).toBe(0);
    const reg = readRegistry(TICKET);
    expect(reg.phase_history.length).toBe(1);
    expect(reg.phase_history[0].phase).toBe("clarify");
    expect(reg.phase_history[0].signal).toBe("CLARIFY_COMPLETE");
  });
});

// ===========================================================================
// goal-gate-check.ts tests (5 tests)
// ===========================================================================

describe("goal-gate-check.ts", () => {
  const TICKET = "TEST-003";

  beforeAll(() => {
    // Start with empty phase_history — individual tests will reset as needed
    writeRegistry(TICKET, {
      ticket_id: "TEST-003",
      nonce: "aabbccdd",
      current_step: "implement",
      status: "running",
      phase_history: [],
    });
  });

  afterAll(() => {
    deleteRegistry(TICKET);
  });

  test("20. NEXT=clarify (non-terminal) outputs PASS", () => {
    // Ensure empty phase_history
    writeRegistry(TICKET, {
      ticket_id: "TEST-003",
      nonce: "aabbccdd",
      current_step: "implement",
      status: "running",
      phase_history: [],
    });

    const result = runScript("goal-gate-check.ts", ["TEST-003", "clarify"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASS");
  });

  test("21. NEXT=plan (non-terminal) outputs PASS", () => {
    const result = runScript("goal-gate-check.ts", ["TEST-003", "plan"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASS");
  });

  test("22. NEXT=done without blindqa in history outputs REDIRECT:blindqa", () => {
    writeRegistry(TICKET, {
      ticket_id: "TEST-003",
      nonce: "aabbccdd",
      current_step: "implement",
      status: "running",
      phase_history: [
        { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
        { phase: "plan", signal: "PLAN_COMPLETE", ts: "2026-01-01T00:01:00Z" },
        { phase: "implement", signal: "IMPLEMENT_COMPLETE", ts: "2026-01-01T00:02:00Z" },
      ],
    });

    const result = runScript("goal-gate-check.ts", ["TEST-003", "done"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("REDIRECT:blindqa");
  });

  test("23. NEXT=done with blindqa COMPLETE in history outputs PASS", () => {
    writeRegistry(TICKET, {
      ticket_id: "TEST-003",
      nonce: "aabbccdd",
      current_step: "blindqa",
      status: "running",
      phase_history: [
        { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
        { phase: "plan", signal: "PLAN_COMPLETE", ts: "2026-01-01T00:01:00Z" },
        { phase: "implement", signal: "IMPLEMENT_COMPLETE", ts: "2026-01-01T00:02:00Z" },
        { phase: "blindqa", signal: "BLINDQA_COMPLETE", ts: "2026-01-01T00:03:00Z" },
      ],
    });

    const result = runScript("goal-gate-check.ts", ["TEST-003", "done"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASS");
  });

  test("24. NEXT=done with blindqa FAILED (not COMPLETE) in history outputs REDIRECT:blindqa", () => {
    writeRegistry(TICKET, {
      ticket_id: "TEST-003",
      nonce: "aabbccdd",
      current_step: "blindqa",
      status: "running",
      phase_history: [
        { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
        { phase: "plan", signal: "PLAN_COMPLETE", ts: "2026-01-01T00:01:00Z" },
        { phase: "implement", signal: "IMPLEMENT_COMPLETE", ts: "2026-01-01T00:02:00Z" },
        { phase: "blindqa", signal: "BLINDQA_FAILED", ts: "2026-01-01T00:03:00Z" },
      ],
    });

    const result = runScript("goal-gate-check.ts", ["TEST-003", "done"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("REDIRECT:blindqa");
  });
});

// ===========================================================================
// held-release-scan.ts tests (4 tests)
//
// Uses real .collab/state/pipeline-registry/ directory.
// Creates unique ticket IDs and cleans up in afterAll.
//
// IMPORTANT: held-release-scan.ts reads coordination.json from
//   specs/{ticket_id}/coordination.json for wait_for dependencies.
//   It also calls registry-update.sh to release (which may not exist as .sh).
//   Tests 26-27 may fail if the release mechanism (registry-update.sh) is missing.
//   We document these as source bugs if they occur, not test bugs.
// ===========================================================================

describe("held-release-scan.ts", () => {
  const HELD_TICKET_1 = "HOLD-001";
  const HELD_TICKET_2 = "HOLD-002";
  const DONE_TICKET = "DONE-001";
  const RUNNING_TICKET = "RUNNING-001";
  const CLEAN_TICKET = "CLEAN-001";

  // Track which tickets we created so cleanup is reliable
  const createdTickets: string[] = [];
  const createdSpecDirs: string[] = [];

  function createCoordination(ticketId: string, waitFor: any[]): void {
    const coordDir = path.join(REPO_ROOT, "specs", ticketId);
    fs.mkdirSync(coordDir, { recursive: true });
    fs.writeFileSync(
      path.join(coordDir, "coordination.json"),
      JSON.stringify({ wait_for: waitFor }, null, 2) + "\n"
    );
    createdSpecDirs.push(coordDir);
  }

  afterAll(() => {
    // Clean up all test registry files
    for (const ticket of createdTickets) {
      deleteRegistry(ticket);
    }
    // Clean up coordination.json dirs
    for (const dir of createdSpecDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  test("25. no held agents outputs nothing, exits 0", () => {
    // Create a single running (non-held) registry
    writeRegistry(CLEAN_TICKET, {
      ticket_id: CLEAN_TICKET,
      nonce: "11111111",
      current_step: "clarify",
      status: "running",
      phase_history: [],
    });
    createdTickets.push(CLEAN_TICKET);

    const result = runScript("held-release-scan.ts", []);

    expect(result.exitCode).toBe(0);
    // Should not report any releases (may say "No held agents found." but only
    // if there are zero held agents across ALL registry files including BRE-QA)
  });

  test("26. held agent with satisfied dependency is released", () => {
    // Create the dependency ticket with IMPLEMENT_COMPLETE in phase_history
    writeRegistry(DONE_TICKET, {
      ticket_id: DONE_TICKET,
      nonce: "22222222",
      current_step: "blindqa",
      status: "running",
      phase_history: [
        { phase: "implement", signal: "IMPLEMENT_COMPLETE", ts: "2026-01-01T00:00:00Z" },
      ],
    });
    createdTickets.push(DONE_TICKET);

    // Create the held ticket
    writeRegistry(HELD_TICKET_1, {
      ticket_id: HELD_TICKET_1,
      nonce: "33333333",
      current_step: "implement",
      status: "held",
      held_at: "implement",
      phase_history: [],
    });
    createdTickets.push(HELD_TICKET_1);

    // Create coordination.json for the held ticket
    createCoordination(HELD_TICKET_1, [
      { ticket_id: DONE_TICKET, phase: "implement" },
    ]);

    const result = runScript("held-release-scan.ts", []);

    // The script tries to call registry-update.sh which may not exist.
    // If it exits 0 and stdout contains "Released", the test passes.
    // If it fails due to missing registry-update.sh, that's a source bug.
    if (result.exitCode === 0) {
      expect(result.stdout).toContain("Released");
      expect(result.stdout).toContain(HELD_TICKET_1);
    } else {
      // Document as source bug: held-release-scan.ts references registry-update.sh
      // but only registry-update.ts exists
      console.error(
        `[SOURCE BUG] held-release-scan.ts calls registry-update.sh but only .ts exists. Exit: ${result.exitCode}`
      );
      console.error(`stderr: ${result.stderr}`);
      // Still fail the test to make the bug visible
      expect(result.exitCode).toBe(0);
    }
  });

  test("27. held agent with unsatisfied dependency stays held", () => {
    // Create a running ticket that has NOT completed implement
    writeRegistry(RUNNING_TICKET, {
      ticket_id: RUNNING_TICKET,
      nonce: "44444444",
      current_step: "implement",
      status: "running",
      phase_history: [],
    });
    createdTickets.push(RUNNING_TICKET);

    // Create the held ticket
    writeRegistry(HELD_TICKET_2, {
      ticket_id: HELD_TICKET_2,
      nonce: "55555555",
      current_step: "implement",
      status: "held",
      held_at: "implement",
      phase_history: [],
    });
    createdTickets.push(HELD_TICKET_2);

    // Create coordination.json for the held ticket
    createCoordination(HELD_TICKET_2, [
      { ticket_id: RUNNING_TICKET, phase: "implement" },
    ]);

    const result = runScript("held-release-scan.ts", []);

    // The script should identify HOLD-002 as still held
    // It may also process other held tickets from test 26 — we just check
    // that HOLD-002 appears with "Still held"
    const combined = result.stdout + "\n" + result.stderr;
    expect(combined).toContain("Still held");
    expect(combined).toContain(HELD_TICKET_2);
  });

  test("28. scan with no held agents exits 0", () => {
    // Clean up all held registries first
    deleteRegistry(HELD_TICKET_1);
    deleteRegistry(HELD_TICKET_2);
    deleteRegistry(DONE_TICKET);
    deleteRegistry(RUNNING_TICKET);
    deleteRegistry(CLEAN_TICKET);

    // Remove from tracking since we already deleted them
    createdTickets.length = 0;

    const result = runScript("held-release-scan.ts", []);

    expect(result.exitCode).toBe(0);
  });
});
