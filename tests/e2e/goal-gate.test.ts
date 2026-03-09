/**
 * tests/e2e/goal-gate.test.ts
 *
 * Category 5: Goal Gate — verifies checkGoalGates works correctly and that
 * the compiled pipeline has the expected goal gate configuration.
 *
 * Uses the real collab.pipeline as input.
 */

import { describe, test, expect } from "bun:test";
import {
  checkGoalGates,
  type GatedPhase,
} from "../../minds/execution/goal-gate-check";
import type { CompiledPipeline } from "../../minds/pipeline_core/types";
import type { PhaseHistoryEntry } from "../../minds/pipeline_core/registry";
import { compileCollab } from "./helpers";

// ── Compile once ──────────────────────────────────────────────────────────────

const compiled = compileCollab();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract gated phases from compiled pipeline (mirrors goal-gate-check.ts logic). */
function getGatedPhases(pipeline: CompiledPipeline): GatedPhase[] {
  return Object.entries(pipeline.phases)
    .filter(([, v]: [string, any]) => v.goal_gate != null)
    .map(([id, v]: [string, any]) => ({ id, goal_gate: v.goal_gate }));
}

function entry(phase: string, signal: string): PhaseHistoryEntry {
  return { phase, signal, ts: "2026-01-01T00:00:00Z" };
}

// ── Category 5a: Pipeline goal gate configuration ─────────────────────────────

describe("e2e/goal-gate: compiled pipeline goal gate configuration", () => {
  test("1. blindqa is the only phase with a goal_gate", () => {
    const gated = getGatedPhases(compiled);
    expect(gated.length).toBe(1);
    expect(gated[0].id).toBe("blindqa");
  });

  test("2. blindqa goal_gate is 'always'", () => {
    expect(compiled.phases["blindqa"].goal_gate).toBe("always");
  });

  test("3. all other phases have no goal_gate", () => {
    for (const [name, phase] of Object.entries(compiled.phases)) {
      if (name === "blindqa") continue;
      expect(phase.goal_gate, `Phase '${name}' should have no goal_gate`).toBeUndefined();
    }
  });
});

// ── Category 5b: checkGoalGates pure function ─────────────────────────────────

describe("e2e/goal-gate: checkGoalGates() pure function", () => {
  const GATED: GatedPhase[] = [{ id: "blindqa", goal_gate: "always" }];

  test("4. empty history + 'always' gate → returns blindqa (REDIRECT)", () => {
    const result = checkGoalGates([], GATED);
    expect(result).toBe("blindqa");
  });

  test("5. history has BLINDQA_COMPLETE → returns null (PASS)", () => {
    const history = [entry("blindqa", "BLINDQA_COMPLETE")];
    const result = checkGoalGates(history, GATED);
    expect(result).toBeNull();
  });

  test("6. history has BLINDQA_FAILED (not _COMPLETE) → returns blindqa (REDIRECT)", () => {
    const history = [entry("blindqa", "BLINDQA_FAILED")];
    const result = checkGoalGates(history, GATED);
    expect(result).toBe("blindqa");
  });

  test("7. history has BLINDQA_ERROR only → returns blindqa (REDIRECT)", () => {
    const history = [entry("blindqa", "BLINDQA_ERROR")];
    const result = checkGoalGates(history, GATED);
    expect(result).toBe("blindqa");
  });

  test("8. no gated phases → returns null (PASS)", () => {
    const result = checkGoalGates([entry("clarify", "CLARIFY_COMPLETE")], []);
    expect(result).toBeNull();
  });

  test("9. 'if_triggered' gate: phase not in history → PASS (not triggered)", () => {
    const ifTriggered: GatedPhase[] = [{ id: "analyze", goal_gate: "if_triggered" }];
    const history: PhaseHistoryEntry[] = []; // analyze never ran
    const result = checkGoalGates(history, ifTriggered);
    expect(result).toBeNull();
  });

  test("10. 'if_triggered' gate: phase ran but not complete → REDIRECT", () => {
    const ifTriggered: GatedPhase[] = [{ id: "analyze", goal_gate: "if_triggered" }];
    const history = [entry("analyze", "ANALYZE_ERROR")]; // ran, but no _COMPLETE
    const result = checkGoalGates(history, ifTriggered);
    expect(result).toBe("analyze");
  });

  test("11. 'if_triggered' gate: phase ran and completed → PASS", () => {
    const ifTriggered: GatedPhase[] = [{ id: "analyze", goal_gate: "if_triggered" }];
    const history = [entry("analyze", "ANALYZE_COMPLETE")];
    const result = checkGoalGates(history, ifTriggered);
    expect(result).toBeNull();
  });

  test("12. multiple gates: first passes, second fails → returns second gate", () => {
    const multiGated: GatedPhase[] = [
      { id: "clarify", goal_gate: "always" },
      { id: "blindqa", goal_gate: "always" },
    ];
    const history = [entry("clarify", "CLARIFY_COMPLETE")]; // clarify done, blindqa not
    const result = checkGoalGates(history, multiGated);
    expect(result).toBe("blindqa");
  });

  test("13. multiple gates: all pass → null", () => {
    const multiGated: GatedPhase[] = [
      { id: "clarify", goal_gate: "always" },
      { id: "blindqa", goal_gate: "always" },
    ];
    const history = [
      entry("clarify", "CLARIFY_COMPLETE"),
      entry("blindqa", "BLINDQA_COMPLETE"),
    ];
    const result = checkGoalGates(history, multiGated);
    expect(result).toBeNull();
  });

  test("14. using compiled pipeline's gated phases: full history with blindqa complete → PASS", () => {
    const gated = getGatedPhases(compiled);
    const history = [
      entry("clarify", "CLARIFY_COMPLETE"),
      entry("plan", "PLAN_COMPLETE"),
      entry("tasks", "TASKS_COMPLETE"),
      entry("analyze", "ANALYZE_COMPLETE"),
      entry("implement", "IMPLEMENT_COMPLETE"),
      entry("blindqa", "BLINDQA_COMPLETE"),
    ];
    const result = checkGoalGates(history, gated);
    expect(result).toBeNull();
  });

  test("15. using compiled pipeline's gated phases: no blindqa in history → REDIRECT:blindqa", () => {
    const gated = getGatedPhases(compiled);
    const history = [
      entry("clarify", "CLARIFY_COMPLETE"),
      entry("plan", "PLAN_COMPLETE"),
      entry("tasks", "TASKS_COMPLETE"),
      entry("analyze", "ANALYZE_COMPLETE"),
      entry("implement", "IMPLEMENT_COMPLETE"),
      // blindqa missing
    ];
    const result = checkGoalGates(history, gated);
    expect(result).toBe("blindqa");
  });
});
