import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  resolvePhaseCommand,
  checkHoldStatus,
  buildDispatchCommand,
  resolvePhaseHooks,
  waitForPhaseCompletion,
} from "./phase-dispatch";
import type { CompiledPipeline } from "../../../lib/pipeline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { writeJsonAtomic } from "../../../lib/pipeline";

const PIPELINE: CompiledPipeline = {
  version: "3.1",
  phases: {
    clarify: {
      command: "/collab.clarify",
      signals: ["CLARIFY_COMPLETE"],
      transitions: {},
      conditionalTransitions: [],
    } as any,
    tasks: {
      actions: [
        { display: "Running tasks phase" },
        { prompt: "/collab.tasks" },
      ],
      signals: ["TASKS_COMPLETE"],
      transitions: {},
      conditionalTransitions: [],
    } as any,
    done: {
      terminal: true,
      signals: [],
      transitions: {},
      conditionalTransitions: [],
    } as any,
  },
};

// ============================================================================
// buildDispatchCommand — --args passthrough
// ============================================================================

describe("phase-dispatch: buildDispatchCommand()", () => {
  test("8. no extraArgs returns base command unchanged", () => {
    expect(buildDispatchCommand("/collab.implement", null)).toBe("/collab.implement");
  });

  test("9. extraArgs appended with space", () => {
    expect(buildDispatchCommand("/collab.implement", "phase:1")).toBe(
      "/collab.implement phase:1"
    );
  });

  test("10. phase range arg appended correctly", () => {
    expect(buildDispatchCommand("/collab.implement", "phase:1-4")).toBe(
      "/collab.implement phase:1-4"
    );
  });

  test("11. empty string extraArgs treated as falsy — no append", () => {
    expect(buildDispatchCommand("/collab.clarify", "")).toBe("/collab.clarify");
  });

  test("12. works with actions-style base command", () => {
    expect(buildDispatchCommand("/collab.tasks", "phase:3")).toBe(
      "/collab.tasks phase:3"
    );
  });
});

describe("phase-dispatch: resolvePhaseCommand()", () => {
  test("1. command phase returns {type:'command', value}", () => {
    const result = resolvePhaseCommand(PIPELINE, "clarify");
    expect(result?.type).toBe("command");
    expect((result as any).value).toBe("/collab.clarify");
  });

  test("2. actions phase returns {type:'actions', value}", () => {
    const result = resolvePhaseCommand(PIPELINE, "tasks");
    expect(result?.type).toBe("actions");
    expect(Array.isArray((result as any).value)).toBe(true);
    expect((result as any).value).toHaveLength(2);
  });

  test("3. terminal phase returns null", () => {
    const result = resolvePhaseCommand(PIPELINE, "done");
    expect(result).toBeNull();
  });

  test("4. unknown phase throws VALIDATION error", () => {
    expect(() => resolvePhaseCommand(PIPELINE, "nonexistent")).toThrow("not found in pipeline.json");
  });
});

describe("phase-dispatch: checkHoldStatus()", () => {
  let tmpDir: string;
  let registryDir: string;
  let repoRoot: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-dispatch-"));
    repoRoot = tmpDir;
    registryDir = path.join(tmpDir, ".collab/state/pipeline-registry");
    fs.mkdirSync(registryDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("5. no coordination.json → not held", () => {
    const result = checkHoldStatus("BRE-99", "clarify", repoRoot, registryDir);
    expect(result.held).toBe(false);
  });

  test("6. satisfied dependency → not held", () => {
    // Create dependency registry with satisfied phase_history
    writeJsonAtomic(path.join(registryDir, "BRE-DEP.json"), {
      ticket_id: "BRE-DEP",
      phase_history: [{ phase: "plan", signal: "PLAN_COMPLETE", ts: "2026-01-01T00:00:00Z" }],
    });

    // Create coordination.json for the ticket
    const specsDir = path.join(repoRoot, "specs", "BRE-100");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, "coordination.json"),
      JSON.stringify({ wait_for: [{ ticket_id: "BRE-DEP", phase: "plan" }] })
    );

    const result = checkHoldStatus("BRE-100", "clarify", repoRoot, registryDir);
    expect(result.held).toBe(false);
  });

  test("7. unsatisfied dependency → held", () => {
    // BRE-DEP2 has no phase_history
    writeJsonAtomic(path.join(registryDir, "BRE-DEP2.json"), {
      ticket_id: "BRE-DEP2",
      phase_history: [],
    });

    const specsDir = path.join(repoRoot, "specs", "BRE-101");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, "coordination.json"),
      JSON.stringify({ wait_for: [{ ticket_id: "BRE-DEP2", phase: "plan" }] })
    );

    const result = checkHoldStatus("BRE-101", "clarify", repoRoot, registryDir);
    expect(result.held).toBe(true);
    expect(result.reason).toBe("BRE-DEP2:plan");
  });
});

// ============================================================================
// resolvePhaseHooks — already partially tested in slice10.test.ts; extra cases
// ============================================================================

describe("phase-dispatch: resolvePhaseHooks()", () => {
  const HOOKED_PIPELINE: CompiledPipeline = {
    version: "3.1",
    phases: {
      setup: { command: "/setup", signals: [] } as any,
      main: {
        command: "/main",
        signals: [],
        before: [{ phase: "setup" }],
        after: [{ phase: "cleanup" }],
      } as any,
      cleanup: { command: "/cleanup", signals: [] } as any,
      done: { terminal: true } as any,
    },
  };

  test("13. phase with before+after returns both arrays", () => {
    const hooks = resolvePhaseHooks(HOOKED_PIPELINE, "main");
    expect(hooks.before).toEqual(["setup"]);
    expect(hooks.after).toEqual(["cleanup"]);
  });

  test("14. phase with no hooks returns empty arrays", () => {
    const hooks = resolvePhaseHooks(HOOKED_PIPELINE, "setup");
    expect(hooks.before).toEqual([]);
    expect(hooks.after).toEqual([]);
  });
});

// ============================================================================
// waitForPhaseCompletion
// ============================================================================

describe("phase-dispatch: waitForPhaseCompletion()", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-hook-wait-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("15. returns true immediately when phase_history already contains _COMPLETE", async () => {
    const regPath = path.join(tmpDir, "hook-ready.json");
    fs.writeFileSync(
      regPath,
      JSON.stringify({
        phase_history: [{ phase: "setup", signal: "SETUP_COMPLETE", ts: "2026-01-01T00:00:00Z" }],
      })
    );

    const result = await waitForPhaseCompletion(regPath, "setup", 1);
    expect(result).toBe(true);
  });

  test("16. returns false when phase never completes within attempts", async () => {
    const regPath = path.join(tmpDir, "hook-pending.json");
    fs.writeFileSync(
      regPath,
      JSON.stringify({ phase_history: [] })
    );

    // Use 1 attempt with a tiny poll interval (override HOOK_POLL_INTERVAL_MS not practical here,
    // but 1 attempt means it polls once and returns false)
    const result = await waitForPhaseCompletion(regPath, "setup", 1);
    expect(result).toBe(false);
  });

  test("17. returns false when registry file does not exist", async () => {
    const result = await waitForPhaseCompletion(path.join(tmpDir, "nonexistent.json"), "setup", 1);
    expect(result).toBe(false);
  });
});
