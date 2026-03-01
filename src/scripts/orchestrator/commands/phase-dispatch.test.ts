import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolvePhaseCommand, checkHoldStatus } from "./phase-dispatch";
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
