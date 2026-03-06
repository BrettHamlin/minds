// check-dependency-hold.ts — Dependency hold check tests
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { checkDependencyHold } from "./check-dependency-hold";
import { spawnCli } from "./test-helpers";

const CLI_PATH = join(import.meta.dir, "check-dependency-hold.ts");

// ============================================================================
// Unit tests: checkDependencyHold
// ============================================================================

describe("checkDependencyHold — pure function", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = join(tmpdir(), `dep-hold-unit-${process.pid}`);
    mkdirSync(join(tmpDir, ".collab/state/pipeline-registry"), { recursive: true });
    mkdirSync(join(tmpDir, ".collab/config"), { recursive: true });

    execSync("git init", { cwd: tmpDir });
    execSync("git checkout -b test-branch", { cwd: tmpDir });

    // Pipeline config required by registryPath resolution
    writeFileSync(
      join(tmpDir, ".collab/config/pipeline.json"),
      JSON.stringify({ version: "3.1", phases: { done: { terminal: true } } })
    );
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  function writeRegistry(ticketId: string, data: Record<string, unknown>) {
    writeFileSync(
      join(tmpDir, ".collab/state/pipeline-registry", `${ticketId}.json`),
      JSON.stringify({ ticket_id: ticketId, ...data })
    );
  }

  function deleteRegistry(ticketId: string) {
    const p = join(tmpDir, ".collab/state/pipeline-registry", `${ticketId}.json`);
    if (existsSync(p)) unlinkSync(p);
  }

  test("returns held=false when no held_by field", () => {
    writeRegistry("BRE-FREE", { current_step: "implement", status: "running" });
    const result = checkDependencyHold("BRE-FREE", tmpDir);
    expect(result.held).toBe(false);
  });

  test("returns held=true external when hold_external is true", () => {
    writeRegistry("BRE-EXT", {
      current_step: "implement",
      held_by: "BRE-999",
      hold_external: true,
      hold_reason: "Linear blockedBy",
    });
    const result = checkDependencyHold("BRE-EXT", tmpDir);
    expect(result.held).toBe(true);
    expect(result.waiting_for).toBe("BRE-999");
    expect(result.external).toBe(true);
    expect(result.reason).toBe("Linear blockedBy");
  });

  test("returns held=true internal when blocker registry exists", () => {
    writeRegistry("BRE-BLOCKER", { current_step: "implement", status: "running" });
    writeRegistry("BRE-BLOCKED", {
      current_step: "clarify",
      held_by: "BRE-BLOCKER",
      hold_external: false,
      hold_reason: "implicit variant dependency",
    });

    const result = checkDependencyHold("BRE-BLOCKED", tmpDir);
    expect(result.held).toBe(true);
    expect(result.waiting_for).toBe("BRE-BLOCKER");
    expect(result.external).toBe(false);
  });

  test("returns released=true when blocker registry is gone (blocker completed)", () => {
    writeRegistry("BRE-HELD-DONE", {
      current_step: "clarify",
      held_by: "BRE-DONE-BLOCKER",
      hold_external: false,
      hold_reason: "implicit variant dependency",
    });
    deleteRegistry("BRE-DONE-BLOCKER");

    const result = checkDependencyHold("BRE-HELD-DONE", tmpDir);
    expect(result.held).toBe(false);
    expect(result.released).toBe(true);
    expect(result.was_waiting_for).toBe("BRE-DONE-BLOCKER");
  });

  test("uses default reason when hold_reason not set", () => {
    writeRegistry("BRE-NO-REASON", {
      current_step: "clarify",
      held_by: "BRE-SOME-BLOCKER",
      hold_external: true,
    });
    const result = checkDependencyHold("BRE-NO-REASON", tmpDir);
    expect(result.held).toBe(true);
    expect(result.reason).toBe("dependency hold");
  });

  test("throws when registry not found", () => {
    expect(() => checkDependencyHold("BRE-NOTFOUND", tmpDir)).toThrow(
      "Registry not found"
    );
  });
});

// ============================================================================
// CLI integration tests
// ============================================================================

let tmpDir: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), `dep-hold-cli-${process.pid}`);
  mkdirSync(join(tmpDir, ".collab/config"), { recursive: true });
  mkdirSync(join(tmpDir, ".collab/state/pipeline-registry"), { recursive: true });

  execSync("git init", { cwd: tmpDir });
  execSync("git checkout -b test-branch", { cwd: tmpDir });

  writeFileSync(
    join(tmpDir, ".collab/config/pipeline.json"),
    JSON.stringify({ version: "3.1", phases: { done: { terminal: true } } })
  );

  // Free ticket
  writeFileSync(
    join(tmpDir, ".collab/state/pipeline-registry/BRE-A.json"),
    JSON.stringify({ ticket_id: "BRE-A", current_step: "implement", status: "running" })
  );

  // External hold
  writeFileSync(
    join(tmpDir, ".collab/state/pipeline-registry/BRE-B.json"),
    JSON.stringify({
      ticket_id: "BRE-B",
      current_step: "clarify",
      held_by: "BRE-EXT-999",
      hold_external: true,
      hold_reason: "Linear blockedBy",
    })
  );

  // Internal hold — blocker exists
  writeFileSync(
    join(tmpDir, ".collab/state/pipeline-registry/BRE-C.json"),
    JSON.stringify({
      ticket_id: "BRE-C",
      current_step: "clarify",
      held_by: "BRE-A",
      hold_external: false,
      hold_reason: "implicit variant dependency",
    })
  );

  // Internal hold — blocker gone (no registry file for BRE-GONE)
  writeFileSync(
    join(tmpDir, ".collab/state/pipeline-registry/BRE-D.json"),
    JSON.stringify({
      ticket_id: "BRE-D",
      current_step: "clarify",
      held_by: "BRE-GONE",
      hold_external: false,
      hold_reason: "implicit variant dependency",
    })
  );
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true });
  } catch {
    /* ignore */
  }
});

function runCli(args: string[], cwd = tmpDir) {
  return spawnCli(CLI_PATH, args, cwd);
}

describe("check-dependency-hold CLI — argument validation", () => {
  test("exits 1 with no args", async () => {
    const { exitCode } = await runCli([]);
    expect(exitCode).toBe(1);
  });

  test("exits 1 when first arg is a flag", async () => {
    const { exitCode } = await runCli(["--flag"]);
    expect(exitCode).toBe(1);
  });

  test("exits 3 when registry not found", async () => {
    const { exitCode } = await runCli(["BRE-MISSING"]);
    expect(exitCode).toBe(3);
  });
});

describe("check-dependency-hold CLI — not held", () => {
  test("returns held=false for ticket with no held_by", async () => {
    const { stdout, exitCode } = await runCli(["BRE-A"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.held).toBe(false);
  });
});

describe("check-dependency-hold CLI — external hold", () => {
  test("returns held=true external for BRE-B", async () => {
    const { stdout, exitCode } = await runCli(["BRE-B"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.held).toBe(true);
    expect(result.waiting_for).toBe("BRE-EXT-999");
    expect(result.external).toBe(true);
    expect(result.reason).toBe("Linear blockedBy");
  });
});

describe("check-dependency-hold CLI — internal hold (blocker running)", () => {
  test("returns held=true internal for BRE-C (BRE-A still running)", async () => {
    const { stdout, exitCode } = await runCli(["BRE-C"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.held).toBe(true);
    expect(result.waiting_for).toBe("BRE-A");
    expect(result.external).toBe(false);
  });
});

describe("check-dependency-hold CLI — internal hold released (blocker done)", () => {
  test("returns released=true for BRE-D (BRE-GONE has no registry)", async () => {
    const { stdout, exitCode } = await runCli(["BRE-D"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.held).toBe(false);
    expect(result.released).toBe(true);
    expect(result.was_waiting_for).toBe("BRE-GONE");
  });
});
