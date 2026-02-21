import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  isDependencySatisfied,
  checkHeldTicket,
  type Dependency,
} from "./held-release-scan";

// ============================================================================
// Test helpers
// ============================================================================

let tmpDir: string;

function setupTmpRegistry(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "held-release-test-"));
  return tmpDir;
}

function writeRegistry(
  dir: string,
  ticketId: string,
  data: Record<string, any>
): void {
  fs.writeFileSync(
    path.join(dir, `${ticketId}.json`),
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
