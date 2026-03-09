import { describe, expect, test } from "bun:test";
import {
  checkGoalGates,
  type GatedPhase,
  type PhaseHistoryEntry,
} from "./goal-gate-check";

// ============================================================================
// checkGoalGates
// ============================================================================

describe("checkGoalGates", () => {
  test("empty phase_history with 'always' gate returns failing phase", () => {
    const gated: GatedPhase[] = [{ id: "blindqa", goal_gate: "always" }];
    const result = checkGoalGates([], gated);
    expect(result).toBe("blindqa");
  });

  test("phase in history with _COMPLETE and 'always' gate -> PASS", () => {
    const history: PhaseHistoryEntry[] = [
      {
        phase: "blindqa",
        signal: "BLINDQA_COMPLETE",
        ts: "2026-01-01T00:00:00Z",
      },
    ];
    const gated: GatedPhase[] = [{ id: "blindqa", goal_gate: "always" }];
    const result = checkGoalGates(history, gated);
    expect(result).toBeNull();
  });

  test("'if_triggered' with no history entry -> PASS (not triggered)", () => {
    const gated: GatedPhase[] = [{ id: "blindqa", goal_gate: "if_triggered" }];
    const result = checkGoalGates([], gated);
    expect(result).toBeNull();
  });

  test("'if_triggered' triggered but no _COMPLETE returns failing phase", () => {
    const history: PhaseHistoryEntry[] = [
      {
        phase: "blindqa",
        signal: "BLINDQA_ERROR",
        ts: "2026-01-01T00:00:00Z",
      },
    ];
    const gated: GatedPhase[] = [{ id: "blindqa", goal_gate: "if_triggered" }];
    const result = checkGoalGates(history, gated);
    expect(result).toBe("blindqa");
  });

  test("'if_triggered' triggered with _COMPLETE -> PASS", () => {
    const history: PhaseHistoryEntry[] = [
      {
        phase: "blindqa",
        signal: "BLINDQA_ERROR",
        ts: "2026-01-01T00:00:00Z",
      },
      {
        phase: "blindqa",
        signal: "BLINDQA_COMPLETE",
        ts: "2026-01-01T01:00:00Z",
      },
    ];
    const gated: GatedPhase[] = [{ id: "blindqa", goal_gate: "if_triggered" }];
    const result = checkGoalGates(history, gated);
    expect(result).toBeNull();
  });

  test("multiple gated phases, first failing returned", () => {
    const history: PhaseHistoryEntry[] = [
      {
        phase: "implement",
        signal: "IMPLEMENT_COMPLETE",
        ts: "2026-01-01T00:00:00Z",
      },
      // blindqa is missing _COMPLETE
    ];
    const gated: GatedPhase[] = [
      { id: "implement", goal_gate: "always" },
      { id: "blindqa", goal_gate: "always" },
    ];
    const result = checkGoalGates(history, gated);
    expect(result).toBe("blindqa");
  });

  test("all gated phases satisfied returns null", () => {
    const history: PhaseHistoryEntry[] = [
      {
        phase: "implement",
        signal: "IMPLEMENT_COMPLETE",
        ts: "2026-01-01T00:00:00Z",
      },
      {
        phase: "blindqa",
        signal: "BLINDQA_COMPLETE",
        ts: "2026-01-01T01:00:00Z",
      },
    ];
    const gated: GatedPhase[] = [
      { id: "implement", goal_gate: "always" },
      { id: "blindqa", goal_gate: "always" },
    ];
    const result = checkGoalGates(history, gated);
    expect(result).toBeNull();
  });

  test("empty gated phases array returns null", () => {
    const result = checkGoalGates([], []);
    expect(result).toBeNull();
  });

  test("'always' gate with only error entries returns failing phase", () => {
    const history: PhaseHistoryEntry[] = [
      {
        phase: "blindqa",
        signal: "BLINDQA_ERROR",
        ts: "2026-01-01T00:00:00Z",
      },
      {
        phase: "blindqa",
        signal: "BLINDQA_FAILED",
        ts: "2026-01-01T01:00:00Z",
      },
    ];
    const gated: GatedPhase[] = [{ id: "blindqa", goal_gate: "always" }];
    const result = checkGoalGates(history, gated);
    expect(result).toBe("blindqa");
  });

  test("mixed always and if_triggered gates evaluated in order", () => {
    const history: PhaseHistoryEntry[] = [
      // implement completed
      {
        phase: "implement",
        signal: "IMPLEMENT_COMPLETE",
        ts: "2026-01-01T00:00:00Z",
      },
      // blindqa triggered but not completed
      {
        phase: "blindqa",
        signal: "BLINDQA_ERROR",
        ts: "2026-01-01T01:00:00Z",
      },
    ];
    const gated: GatedPhase[] = [
      { id: "implement", goal_gate: "always" },
      { id: "blindqa", goal_gate: "if_triggered" },
    ];
    const result = checkGoalGates(history, gated);
    // blindqa was triggered (has an entry) but not completed
    expect(result).toBe("blindqa");
  });
});
