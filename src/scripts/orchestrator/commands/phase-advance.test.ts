import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getNextPhase, getFirstPhase, isTerminalPhase } from "./phase-advance";
import type { CompiledPipeline } from "../../../lib/pipeline";
import { resolvePipelineConfigPath, writeJsonAtomic } from "../../../lib/pipeline";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Minimal pipeline fixture matching current v3.1 format
const PIPELINE: CompiledPipeline = {
  version: "3.1",
  phases: {
    clarify: { command: "/collab.clarify", signals: ["CLARIFY_COMPLETE", "CLARIFY_QUESTION"], transitions: {}, conditionalTransitions: [] } as any,
    plan: { command: "/collab.plan", signals: ["PLAN_COMPLETE"], transitions: {}, conditionalTransitions: [] } as any,
    tasks: { command: "/collab.tasks", signals: ["TASKS_COMPLETE"], transitions: {}, conditionalTransitions: [] } as any,
    analyze: { command: "/collab.analyze", signals: ["ANALYZE_COMPLETE"], transitions: {}, conditionalTransitions: [] } as any,
    implement: { command: "/collab.implement", signals: ["IMPLEMENT_COMPLETE"], transitions: {}, conditionalTransitions: [] } as any,
    blindqa: { command: "/collab.blindqa", signals: ["BLINDQA_COMPLETE"], transitions: {}, conditionalTransitions: [] } as any,
    done: { terminal: true, signals: [], transitions: {}, conditionalTransitions: [] } as any,
  },
};

describe("phase-advance: getNextPhase()", () => {
  test("1. clarify → plan", () => {
    expect(getNextPhase(PIPELINE, "clarify")).toBe("plan");
  });

  test("2. plan → tasks", () => {
    expect(getNextPhase(PIPELINE, "plan")).toBe("tasks");
  });

  test("3. done → done (sentinel)", () => {
    expect(getNextPhase(PIPELINE, "done")).toBe("done");
  });

  test("4. last non-done phase → done", () => {
    // blindqa is second-to-last, done is last
    expect(getNextPhase(PIPELINE, "blindqa")).toBe("done");
  });

  test("5. invalid phase throws OrchestratorError VALIDATION", () => {
    expect(() => getNextPhase(PIPELINE, "nonexistent")).toThrow("Invalid phase");
  });
});

describe("phase-advance: getFirstPhase()", () => {
  test("6. returns first phase key (clarify)", () => {
    expect(getFirstPhase(PIPELINE)).toBe("clarify");
  });

  test("7. empty phases object throws VALIDATION", () => {
    const empty = { ...PIPELINE, phases: {} } as any;
    expect(() => getFirstPhase(empty)).toThrow("Pipeline has no phases");
  });
});

describe("phase-advance: isTerminalPhase()", () => {
  test("8. done → true", () => {
    expect(isTerminalPhase(PIPELINE, "done")).toBe(true);
  });

  test("9. clarify → false", () => {
    expect(isTerminalPhase(PIPELINE, "clarify")).toBe(false);
  });

  test("10. unknown phase throws VALIDATION", () => {
    expect(() => isTerminalPhase(PIPELINE, "nonexistent")).toThrow("Unknown phase");
  });
});

// ============================================================================
// Variant config loading (resolvePipelineConfigPath integration)
// ============================================================================

describe("phase-advance: variant config loading", () => {
  let tmpDir: string;
  let variantsDir: string;
  let registryDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-advance-variant-"));
    variantsDir = path.join(tmpDir, ".collab", "config", "pipeline-variants");
    registryDir = path.join(tmpDir, ".collab", "state", "pipeline-registry");
    fs.mkdirSync(variantsDir, { recursive: true });
    fs.mkdirSync(registryDir, { recursive: true });

    // Write default pipeline
    fs.mkdirSync(path.join(tmpDir, ".collab", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".collab", "config", "pipeline.json"),
      JSON.stringify({ version: "3.1", phases: {}, id: "default" })
    );
    // Write a named variant
    fs.writeFileSync(
      path.join(variantsDir, "slim.json"),
      JSON.stringify({ version: "3.1", phases: {}, id: "slim" })
    );
    // Write a registry entry with pipeline_variant
    writeJsonAtomic(path.join(registryDir, "BRE-ADV.json"), {
      ticket_id: "BRE-ADV",
      pipeline_variant: "slim",
    });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("11. --pipeline variant resolves to variant config path", () => {
    const configPath = resolvePipelineConfigPath(tmpDir, { variant: "slim" });
    expect(configPath).toBe(path.join(variantsDir, "slim.json"));
    expect(fs.existsSync(configPath)).toBe(true);
  });

  test("12. --ticket reads pipeline_variant from registry", () => {
    const configPath = resolvePipelineConfigPath(tmpDir, {
      ticketId: "BRE-ADV",
      registryDir,
    });
    expect(configPath).toBe(path.join(variantsDir, "slim.json"));
  });

  test("13. missing variant falls back to default pipeline.json", () => {
    const configPath = resolvePipelineConfigPath(tmpDir, { variant: "nonexistent" });
    expect(configPath).toBe(path.join(tmpDir, ".collab", "config", "pipeline.json"));
  });
});
