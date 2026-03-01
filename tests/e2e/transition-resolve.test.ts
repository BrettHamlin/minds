/**
 * tests/e2e/transition-resolve.test.ts
 *
 * Category 3: Transition Resolution — verifies resolveTransition and
 * resolveConditionalTransition work correctly with the compiled pipeline.
 *
 * Uses the real collab.pipeline as input.
 */

import { describe, test, expect } from "bun:test";
import {
  resolveTransition,
  resolveConditionalTransition,
} from "../../src/lib/pipeline/transitions";
import { compileCollab } from "./helpers";

// ── Compile once ──────────────────────────────────────────────────────────────

const compiled = compileCollab();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("e2e/transition-resolve: resolveTransition(compiled, ...)", () => {
  test("1. clarify + CLARIFY_COMPLETE → direct to plan", () => {
    const result = resolveTransition("clarify", "CLARIFY_COMPLETE", compiled);
    expect(result).toEqual({
      to: "plan",
      gate: null,
      if: null,
      conditional: false,
    });
  });

  test("2. plan + PLAN_COMPLETE → gate plan_review", () => {
    const result = resolveTransition("plan", "PLAN_COMPLETE", compiled);
    expect(result).toEqual({
      to: null,
      gate: "plan_review",
      if: null,
      conditional: false,
    });
  });

  test("3. plan + PLAN_ERROR → direct to plan (self-loop)", () => {
    const result = resolveTransition("plan", "PLAN_ERROR", compiled);
    expect(result).toEqual({
      to: "plan",
      gate: null,
      if: null,
      conditional: false,
    });
  });

  test("4. tasks + TASKS_COMPLETE → direct to analyze", () => {
    const result = resolveTransition("tasks", "TASKS_COMPLETE", compiled);
    expect(result).toEqual({
      to: "analyze",
      gate: null,
      if: null,
      conditional: false,
    });
  });

  test("5. analyze + ANALYZE_COMPLETE → gate analyze_review", () => {
    const result = resolveTransition("analyze", "ANALYZE_COMPLETE", compiled);
    expect(result).toEqual({
      to: null,
      gate: "analyze_review",
      if: null,
      conditional: false,
    });
  });

  test("6. implement + IMPLEMENT_COMPLETE → first conditional row (hasGroup)", () => {
    const result = resolveTransition("implement", "IMPLEMENT_COMPLETE", compiled);
    expect(result).not.toBeNull();
    expect(result!.conditional).toBe(true);
    expect(result!.if).toBe("hasGroup");
    expect(result!.to).toBe("tasks");
    expect(result!.gate).toBeNull();
  });

  test("7. implement + IMPLEMENT_ERROR → direct to implement (self-loop)", () => {
    const result = resolveTransition("implement", "IMPLEMENT_ERROR", compiled);
    expect(result).toEqual({
      to: "implement",
      gate: null,
      if: null,
      conditional: false,
    });
  });

  test("8. blindqa + BLINDQA_COMPLETE → direct to done", () => {
    const result = resolveTransition("blindqa", "BLINDQA_COMPLETE", compiled);
    expect(result).toEqual({
      to: "done",
      gate: null,
      if: null,
      conditional: false,
    });
  });

  test("9. blindqa + BLINDQA_FAILED → direct to blindqa (self-loop)", () => {
    const result = resolveTransition("blindqa", "BLINDQA_FAILED", compiled);
    expect(result).toEqual({
      to: "blindqa",
      gate: null,
      if: null,
      conditional: false,
    });
  });

  test("10. unknown signal returns null", () => {
    const result = resolveTransition("clarify", "NONEXISTENT_SIGNAL", compiled);
    expect(result).toBeNull();
  });

  test("11. done (terminal) + any signal returns null (no transitions)", () => {
    const result = resolveTransition("done", "CLARIFY_COMPLETE", compiled);
    expect(result).toBeNull();
  });

  test("12. unknown phase returns null", () => {
    const result = resolveTransition("nonexistent", "CLARIFY_COMPLETE", compiled);
    expect(result).toBeNull();
  });
});

describe("e2e/transition-resolve: resolveConditionalTransition(rows, ...)", () => {
  test("13. implement IMPLEMENT_COMPLETE → otherwise branch → to: blindqa", () => {
    const rows = compiled.phases["implement"].conditionalTransitions ?? [];
    expect(rows.length).toBeGreaterThan(0);

    const result = resolveConditionalTransition(rows, "IMPLEMENT_COMPLETE");
    expect(result).not.toBeNull();
    expect(result).toEqual({ to: "blindqa" });
  });

  test("14. implement rows have both conditional (hasGroup) and otherwise branches", () => {
    const rows = compiled.phases["implement"].conditionalTransitions ?? [];
    const allForSignal = rows.filter((r) => r.signal === "IMPLEMENT_COMPLETE");
    expect(allForSignal.length).toBe(2);

    const hasGroupBranch = allForSignal.find((r) => r.if === "hasGroup");
    const otherwiseBranch = allForSignal.find((r) => r.if === undefined);
    expect(hasGroupBranch).toBeDefined();
    expect(hasGroupBranch!.to).toBe("tasks");
    expect(otherwiseBranch).toBeDefined();
    expect(otherwiseBranch!.to).toBe("blindqa");
  });

  test("15. unknown signal returns null", () => {
    const rows = compiled.phases["implement"].conditionalTransitions ?? [];
    const result = resolveConditionalTransition(rows, "NONEXISTENT_SIGNAL");
    expect(result).toBeNull();
  });
});
