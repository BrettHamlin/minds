import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  isDependencySatisfied,
  checkHeldTicket,
  isDependencyHoldSatisfied,
  type Dependency,
} from "./held-release-scan";

// ============================================================================
// Test helpers
// ============================================================================

let tmpDir: string;
const REGISTRY_SUBDIR = path.join(".collab", "state", "pipeline-registry");

function setupTmpRegistry(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "held-release-test-"));
  fs.mkdirSync(path.join(tmpDir, REGISTRY_SUBDIR), { recursive: true });
  return tmpDir;
}

function writeRegistry(
  repoRoot: string,
  ticketId: string,
  data: Record<string, any>
): void {
  fs.writeFileSync(
    path.join(repoRoot, REGISTRY_SUBDIR, `${ticketId}.json`),
    JSON.stringify(data, null, 2)
  );
}

// ============================================================================
// isDependencySatisfied
// ============================================================================

describe("isDependencySatisfied", () => {
  beforeEach(() => {
    setupTmpRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns true when dep has completed phase in history", () => {
    writeRegistry(tmpDir, "BRE-100", {
      ticket_id: "BRE-100",
      phase_history: [
        {
          phase: "clarify",
          signal: "CLARIFY_COMPLETE",
          ts: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const dep: Dependency = { ticket_id: "BRE-100", phase: "clarify" };
    expect(isDependencySatisfied(dep, tmpDir)).toBe(true);
  });

  test("returns false when dep has phase but no _COMPLETE signal", () => {
    writeRegistry(tmpDir, "BRE-100", {
      ticket_id: "BRE-100",
      phase_history: [
        {
          phase: "clarify",
          signal: "CLARIFY_ERROR",
          ts: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const dep: Dependency = { ticket_id: "BRE-100", phase: "clarify" };
    expect(isDependencySatisfied(dep, tmpDir)).toBe(false);
  });

  test("returns false when dep registry has no phase_history", () => {
    writeRegistry(tmpDir, "BRE-100", {
      ticket_id: "BRE-100",
      status: "running",
    });

    const dep: Dependency = { ticket_id: "BRE-100", phase: "clarify" };
    expect(isDependencySatisfied(dep, tmpDir)).toBe(false);
  });

  test("returns false when dep registry does not exist", () => {
    const dep: Dependency = { ticket_id: "BRE-999", phase: "clarify" };
    expect(isDependencySatisfied(dep, tmpDir)).toBe(false);
  });

  test("returns false when phase does not match", () => {
    writeRegistry(tmpDir, "BRE-100", {
      ticket_id: "BRE-100",
      phase_history: [
        {
          phase: "plan",
          signal: "PLAN_COMPLETE",
          ts: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const dep: Dependency = { ticket_id: "BRE-100", phase: "clarify" };
    expect(isDependencySatisfied(dep, tmpDir)).toBe(false);
  });

  test("returns true when multiple history entries and one matches", () => {
    writeRegistry(tmpDir, "BRE-100", {
      ticket_id: "BRE-100",
      phase_history: [
        {
          phase: "clarify",
          signal: "CLARIFY_ERROR",
          ts: "2026-01-01T00:00:00Z",
        },
        {
          phase: "clarify",
          signal: "CLARIFY_COMPLETE",
          ts: "2026-01-01T01:00:00Z",
        },
      ],
    });

    const dep: Dependency = { ticket_id: "BRE-100", phase: "clarify" };
    expect(isDependencySatisfied(dep, tmpDir)).toBe(true);
  });
});

// ============================================================================
// checkHeldTicket
// ============================================================================

describe("checkHeldTicket", () => {
  beforeEach(() => {
    setupTmpRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns satisfied when all deps are met", () => {
    writeRegistry(tmpDir, "BRE-100", {
      ticket_id: "BRE-100",
      phase_history: [
        {
          phase: "clarify",
          signal: "CLARIFY_COMPLETE",
          ts: "2026-01-01T00:00:00Z",
        },
      ],
    });
    writeRegistry(tmpDir, "BRE-101", {
      ticket_id: "BRE-101",
      phase_history: [
        {
          phase: "plan",
          signal: "PLAN_COMPLETE",
          ts: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const waitFor: Dependency[] = [
      { ticket_id: "BRE-100", phase: "clarify" },
      { ticket_id: "BRE-101", phase: "plan" },
    ];

    const result = checkHeldTicket("BRE-200", waitFor, tmpDir);
    expect(result.satisfied).toBe(true);
    expect(result.blockingDep).toBeUndefined();
  });

  test("returns first blocking dep when one is not satisfied", () => {
    writeRegistry(tmpDir, "BRE-100", {
      ticket_id: "BRE-100",
      phase_history: [
        {
          phase: "clarify",
          signal: "CLARIFY_COMPLETE",
          ts: "2026-01-01T00:00:00Z",
        },
      ],
    });
    // BRE-101 has NOT completed plan
    writeRegistry(tmpDir, "BRE-101", {
      ticket_id: "BRE-101",
      phase_history: [
        {
          phase: "plan",
          signal: "PLAN_ERROR",
          ts: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const waitFor: Dependency[] = [
      { ticket_id: "BRE-100", phase: "clarify" },
      { ticket_id: "BRE-101", phase: "plan" },
    ];

    const result = checkHeldTicket("BRE-200", waitFor, tmpDir);
    expect(result.satisfied).toBe(false);
    expect(result.blockingDep).toBe("BRE-101:plan");
  });

  test("returns satisfied for empty waitFor array", () => {
    const result = checkHeldTicket("BRE-200", [], tmpDir);
    expect(result.satisfied).toBe(true);
  });

  test("returns blocking when dep registry is missing", () => {
    const waitFor: Dependency[] = [
      { ticket_id: "BRE-MISSING", phase: "clarify" },
    ];

    const result = checkHeldTicket("BRE-200", waitFor, tmpDir);
    expect(result.satisfied).toBe(false);
    expect(result.blockingDep).toBe("BRE-MISSING:clarify");
  });
});

// ============================================================================
// isDependencyHoldSatisfied
// ============================================================================

describe("isDependencyHoldSatisfied", () => {
  let holdTmpDir: string;

  beforeEach(() => {
    holdTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-hold-test-"));
    fs.mkdirSync(path.join(holdTmpDir, REGISTRY_SUBDIR), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(holdTmpDir, { recursive: true, force: true });
  });

  function writeReg(repoRoot: string, ticketId: string, data: Record<string, any>): void {
    fs.writeFileSync(
      path.join(repoRoot, REGISTRY_SUBDIR, `${ticketId}.json`),
      JSON.stringify(data, null, 2)
    );
  }

  test("release_when=done: returns true when blocker registry does not exist", () => {
    // BRE-400 registry does not exist → pipeline completed
    expect(isDependencyHoldSatisfied("BRE-400", "done", holdTmpDir)).toBe(true);
  });

  test("release_when=done: returns false when blocker registry exists", () => {
    writeReg(holdTmpDir, "BRE-410", { ticket_id: "BRE-410", status: "running" });
    expect(isDependencyHoldSatisfied("BRE-410", "done", holdTmpDir)).toBe(false);
  });

  test("release_when=clarify: returns true when blocker has clarify COMPLETE in history", () => {
    writeReg(holdTmpDir, "BRE-420", {
      ticket_id: "BRE-420",
      phase_history: [
        { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(isDependencyHoldSatisfied("BRE-420", "clarify", holdTmpDir)).toBe(true);
  });

  test("release_when=plan: returns false when blocker only has clarify COMPLETE", () => {
    writeReg(holdTmpDir, "BRE-430", {
      ticket_id: "BRE-430",
      phase_history: [
        { phase: "clarify", signal: "CLARIFY_COMPLETE", ts: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(isDependencyHoldSatisfied("BRE-430", "plan", holdTmpDir)).toBe(false);
  });

  test("release_when=plan: returns false when blocker registry does not exist", () => {
    // For non-done phases, missing registry means blocker never ran → not satisfied
    expect(isDependencyHoldSatisfied("BRE-440-MISSING", "plan", holdTmpDir)).toBe(false);
  });

  test("release_when=plan: returns false when phase exists but signal is not _COMPLETE", () => {
    writeReg(holdTmpDir, "BRE-450", {
      ticket_id: "BRE-450",
      phase_history: [
        { phase: "plan", signal: "PLAN_ERROR", ts: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(isDependencyHoldSatisfied("BRE-450", "plan", holdTmpDir)).toBe(false);
  });

  test("release_when=done: returns false when blocker registry exists with empty phase_history", () => {
    writeReg(holdTmpDir, "BRE-460", { ticket_id: "BRE-460", phase_history: [] });
    expect(isDependencyHoldSatisfied("BRE-460", "done", holdTmpDir)).toBe(false);
  });
});
