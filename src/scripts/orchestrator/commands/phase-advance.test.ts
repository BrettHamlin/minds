import { describe, test, expect } from "bun:test";
import { getNextPhase, getFirstPhase, isTerminalPhase } from "./phase-advance";
import type { CompiledPipeline } from "../../../lib/pipeline";

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
