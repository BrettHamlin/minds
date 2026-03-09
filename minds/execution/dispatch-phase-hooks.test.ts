// dispatch-phase-hooks.ts — Phase hook resolution tests
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

import { resolveHooksForPhase } from "./dispatch-phase-hooks";
import { spawnCli } from "./test-helpers";

const CLI_PATH = join(import.meta.dir, "dispatch-phase-hooks.ts");

// ============================================================================
// Unit tests: resolveHooksForPhase
// ============================================================================

describe("resolveHooksForPhase", () => {
  const pipeline = {
    phases: {
      implement: {
        command: "/collab.implement",
        before: [{ phase: "pre-check" }, { phase: "pre-lint" }],
        after: [{ phase: "post-notify" }],
      },
      clarify: {
        command: "/collab.clarify",
      },
      done: {
        terminal: true,
      },
    },
  };

  test("returns before hooks for a phase with before array", () => {
    const hooks = resolveHooksForPhase(pipeline, "implement", "pre");
    expect(hooks).toEqual(["pre-check", "pre-lint"]);
  });

  test("returns after hooks for a phase with after array", () => {
    const hooks = resolveHooksForPhase(pipeline, "implement", "post");
    expect(hooks).toEqual(["post-notify"]);
  });

  test("returns empty array when phase has no before hooks", () => {
    const hooks = resolveHooksForPhase(pipeline, "clarify", "pre");
    expect(hooks).toEqual([]);
  });

  test("returns empty array when phase has no after hooks", () => {
    const hooks = resolveHooksForPhase(pipeline, "clarify", "post");
    expect(hooks).toEqual([]);
  });

  test("returns empty array for unknown phase", () => {
    const hooks = resolveHooksForPhase(pipeline, "nonexistent", "pre");
    expect(hooks).toEqual([]);
  });

  test("returns empty array for terminal phase with no hooks", () => {
    const hooks = resolveHooksForPhase(pipeline, "done", "post");
    expect(hooks).toEqual([]);
  });

  test("filters out hook entries with no phase field", () => {
    const pipelineWithBadHook = {
      phases: {
        plan: {
          command: "/collab.plan",
          before: [{ phase: "pre-plan" }, { other: "not-a-hook" }, { phase: "" }],
        },
      },
    };
    const hooks = resolveHooksForPhase(pipelineWithBadHook, "plan", "pre");
    expect(hooks).toEqual(["pre-plan"]);
  });

  test("returns empty array when before/after is not an array", () => {
    const pipelineWithScalar = {
      phases: {
        plan: {
          command: "/collab.plan",
          before: "not-an-array",
        },
      },
    };
    const hooks = resolveHooksForPhase(pipelineWithScalar as any, "plan", "pre");
    expect(hooks).toEqual([]);
  });
});

// ============================================================================
// CLI integration tests
// ============================================================================

let tmpDir: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), `dispatch-phase-hooks-${process.pid}`);
  mkdirSync(join(tmpDir, ".minds/config"), { recursive: true });
  mkdirSync(join(tmpDir, ".minds/state/pipeline-registry"), { recursive: true });

  execSync("git init", { cwd: tmpDir });
  execSync("git checkout -b test-branch", { cwd: tmpDir });

  // Pipeline config with hooks
  writeFileSync(
    join(tmpDir, ".minds/config/pipeline.json"),
    JSON.stringify({
      version: "3.1",
      phases: {
        clarify: {
          command: "/collab.clarify",
          signals: [],
          transitions: {},
        },
        implement: {
          command: "/collab.implement",
          signals: [],
          transitions: {},
          before: [{ phase: "pre-check" }],
          after: [{ phase: "post-notify" }, { phase: "post-cleanup" }],
        },
        done: { terminal: true },
      },
    })
  );

  // Registry pointing at "implement"
  writeFileSync(
    join(tmpDir, ".minds/state/pipeline-registry/BRE-HOOKS.json"),
    JSON.stringify({ ticket_id: "BRE-HOOKS", current_step: "implement" })
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

describe("dispatch-phase-hooks CLI — argument validation", () => {
  test("exits 1 with no args", async () => {
    const { exitCode } = await runCli([]);
    expect(exitCode).toBe(1);
  });

  test("exits 1 with only ticket ID", async () => {
    const { exitCode } = await runCli(["BRE-HOOKS"]);
    expect(exitCode).toBe(1);
  });

  test("exits 1 when first arg is a flag", async () => {
    const { exitCode } = await runCli(["--bad-flag", "pre"]);
    expect(exitCode).toBe(1);
  });

  test("exits 1 for invalid hook type", async () => {
    const { exitCode } = await runCli(["BRE-HOOKS", "invalid"]);
    expect(exitCode).toBe(1);
  });
});

describe("dispatch-phase-hooks CLI — pre hooks (current_step from registry)", () => {
  test("returns before hooks for current_step (implement)", async () => {
    const { stdout, exitCode } = await runCli(["BRE-HOOKS", "pre"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.hooks).toEqual(["pre-check"]);
    expect(result.count).toBe(1);
    expect(result.phase).toBe("implement");
    expect(result.type).toBe("pre");
    expect(result.empty).toBe(false);
  });

  test("returns empty for clarify (no before hooks) via --phase flag", async () => {
    const { stdout, exitCode } = await runCli(["BRE-HOOKS", "pre", "--phase", "clarify"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.hooks).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.empty).toBe(true);
    expect(result.phase).toBe("clarify");
  });
});

describe("dispatch-phase-hooks CLI — post hooks", () => {
  test("returns after hooks for implement via --phase flag", async () => {
    const { stdout, exitCode } = await runCli(["BRE-HOOKS", "post", "--phase", "implement"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.hooks).toEqual(["post-notify", "post-cleanup"]);
    expect(result.count).toBe(2);
    expect(result.phase).toBe("implement");
    expect(result.type).toBe("post");
    expect(result.empty).toBe(false);
  });

  test("returns empty for phase with no after hooks", async () => {
    const { stdout, exitCode } = await runCli(["BRE-HOOKS", "post", "--phase", "clarify"]);
    expect(exitCode).toBe(0);

    const result = JSON.parse(stdout);
    expect(result.hooks).toEqual([]);
    expect(result.empty).toBe(true);
  });
});

describe("dispatch-phase-hooks CLI — registry fallback", () => {
  test("exits 3 when registry not found", async () => {
    const { exitCode } = await runCli(["BRE-MISSING", "pre"]);
    expect(exitCode).toBe(3);
  });
});
