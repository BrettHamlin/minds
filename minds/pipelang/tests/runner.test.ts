// Runner routing logic tests — no tmux required
// Tests resolveGateResponse() and resolveConditionalTransition()
import { describe, test, expect } from "bun:test";
import { resolveGateResponse, resolveConditionalTransition } from "../src/runner";
import type { CompiledGate, ConditionalTransitionRow } from "../src/compiler";

// ── Gate fixture helpers ──────────────────────────────────────────────────────

function makeGate(overrides: Partial<CompiledGate> = {}): CompiledGate {
  return {
    prompt: ".minds/config/gates/plan.md",
    on: {},
    ...overrides,
  };
}

// ── APPROVED → tasks (simple unconditional routing) ───────────────────────────

describe("resolveGateResponse: unconditional to:", () => {
  const gate = makeGate({ on: { APPROVED: { to: "tasks" } } });

  test("APPROVED routes to tasks", () => {
    const result = resolveGateResponse("plan_review", gate, "APPROVED", 0);
    expect(result).toEqual({ nextPhase: "tasks" });
  });

  test("APPROVED routes to tasks on retry 5 (no maxRetries set)", () => {
    const result = resolveGateResponse("plan_review", gate, "APPROVED", 5);
    expect(result).toEqual({ nextPhase: "tasks" });
  });
});

// ── REVISION_NEEDED with maxRetries + onExhaust: skip ─────────────────────────

describe("resolveGateResponse: maxRetries + onExhaust: skip", () => {
  const gate = makeGate({
    skipTo: "tasks",
    on: {
      APPROVED: { to: "tasks" },
      REVISION_NEEDED: { to: "plan", feedback: "enrich", maxRetries: 3, onExhaust: "skip" },
    },
  });

  test("first retry routes back to plan (retriesSoFar=0)", () => {
    expect(resolveGateResponse("plan_review", gate, "REVISION_NEEDED", 0)).toEqual({ nextPhase: "plan" });
  });

  test("second retry routes back to plan (retriesSoFar=1)", () => {
    expect(resolveGateResponse("plan_review", gate, "REVISION_NEEDED", 1)).toEqual({ nextPhase: "plan" });
  });

  test("third retry routes back to plan (retriesSoFar=2)", () => {
    expect(resolveGateResponse("plan_review", gate, "REVISION_NEEDED", 2)).toEqual({ nextPhase: "plan" });
  });

  test("exhausted at maxRetries=3 (retriesSoFar=3) → skipTo tasks", () => {
    expect(resolveGateResponse("plan_review", gate, "REVISION_NEEDED", 3)).toEqual({ nextPhase: "tasks" });
  });

  test("exhausted beyond maxRetries (retriesSoFar=99) → skipTo tasks", () => {
    expect(resolveGateResponse("plan_review", gate, "REVISION_NEEDED", 99)).toEqual({ nextPhase: "tasks" });
  });
});

// ── onExhaust: abort (no to:) ─────────────────────────────────────────────────

describe("resolveGateResponse: no to: + onExhaust: abort", () => {
  const gate = makeGate({
    on: {
      REMEDIATION_COMPLETE: { to: "implement" },
      ESCALATION: { feedback: "raw", onExhaust: "abort" },
    },
  });

  test("ESCALATION immediately errors (no to:, onExhaust: abort)", () => {
    const result = resolveGateResponse("analyze_review", gate, "ESCALATION", 0);
    expect("error" in result).toBe(true);
    expect((result as any).error).toContain("ESCALATION");
    expect((result as any).error).toContain("abort");
  });

  test("REMEDIATION_COMPLETE routes to implement", () => {
    expect(resolveGateResponse("analyze_review", gate, "REMEDIATION_COMPLETE", 0)).toEqual({
      nextPhase: "implement",
    });
  });
});

// ── onExhaust: escalate ───────────────────────────────────────────────────────

describe("resolveGateResponse: onExhaust: escalate", () => {
  const gate = makeGate({
    on: {
      CRITICAL: { onExhaust: "escalate" },
    },
  });

  test("CRITICAL with onExhaust: escalate returns error", () => {
    const result = resolveGateResponse("my_gate", gate, "CRITICAL", 0);
    expect("error" in result).toBe(true);
    expect((result as any).error).toContain("escalate");
  });
});

// ── skip without skipTo defined ───────────────────────────────────────────────

describe("resolveGateResponse: onExhaust: skip without skipTo", () => {
  const gate = makeGate({
    // no skipTo
    on: {
      REVISION_NEEDED: { to: "plan", maxRetries: 1, onExhaust: "skip" },
    },
  });

  test("exhausted skip with no skipTo → error", () => {
    const result = resolveGateResponse("gate_no_skip", gate, "REVISION_NEEDED", 1);
    expect("error" in result).toBe(true);
    expect((result as any).error).toContain("skipTo");
  });
});

// ── Unknown signal ────────────────────────────────────────────────────────────

describe("resolveGateResponse: unknown signal", () => {
  const gate = makeGate({ on: { APPROVED: { to: "next" } } });

  test("unregistered signal returns error", () => {
    const result = resolveGateResponse("my_gate", gate, "UNKNOWN_SIGNAL", 0);
    expect("error" in result).toBe(true);
    expect((result as any).error).toContain("UNKNOWN_SIGNAL");
  });
});

// ── resolveConditionalTransition ─────────────────────────────────────────────

describe("resolveConditionalTransition: otherwise branch (to:)", () => {
  // Matches the implement phase in collab.pipeline:
  //   .on(IMPLEMENT_COMPLETE, when: hasGroup, to: tasks)
  //   .on(IMPLEMENT_COMPLETE, otherwise, to: blindqa)
  const rows: ConditionalTransitionRow[] = [
    { signal: "IMPLEMENT_COMPLETE", if: "hasGroup", to: "tasks" },
    { signal: "IMPLEMENT_COMPLETE", to: "blindqa" },
  ];

  test("picks otherwise branch (to: blindqa)", () => {
    const result = resolveConditionalTransition(rows, "IMPLEMENT_COMPLETE");
    expect(result).toEqual({ to: "blindqa" });
  });

  test("returns null for unmatched signal", () => {
    const result = resolveConditionalTransition(rows, "IMPLEMENT_ERROR");
    expect(result).toBeNull();
  });
});

describe("resolveConditionalTransition: otherwise branch (gate:)", () => {
  const rows: ConditionalTransitionRow[] = [
    { signal: "BUILD_DONE", if: "hasTests", gate: "test_gate" },
    { signal: "BUILD_DONE", gate: "deploy_gate" },
  ];

  test("picks otherwise branch with gate target", () => {
    const result = resolveConditionalTransition(rows, "BUILD_DONE");
    expect(result).toEqual({ gate: "deploy_gate" });
  });
});

describe("resolveConditionalTransition: single otherwise row", () => {
  const rows: ConditionalTransitionRow[] = [
    { signal: "SIG_A", to: "next_phase" },
  ];

  test("matches single row without if (pure otherwise)", () => {
    const result = resolveConditionalTransition(rows, "SIG_A");
    expect(result).toEqual({ to: "next_phase" });
  });
});

describe("resolveConditionalTransition: multiple signals in same array", () => {
  const rows: ConditionalTransitionRow[] = [
    { signal: "SIG_A", if: "cond1", to: "phase_a" },
    { signal: "SIG_A", to: "phase_b" },
    { signal: "SIG_B", if: "cond2", to: "phase_c" },
    { signal: "SIG_B", to: "phase_d" },
  ];

  test("SIG_A routes to its otherwise (phase_b)", () => {
    expect(resolveConditionalTransition(rows, "SIG_A")).toEqual({ to: "phase_b" });
  });

  test("SIG_B routes to its otherwise (phase_d)", () => {
    expect(resolveConditionalTransition(rows, "SIG_B")).toEqual({ to: "phase_d" });
  });

  test("SIG_C not present → null", () => {
    expect(resolveConditionalTransition(rows, "SIG_C")).toBeNull();
  });
});

describe("resolveConditionalTransition: empty rows array", () => {
  test("empty array returns null", () => {
    expect(resolveConditionalTransition([], "ANY_SIGNAL")).toBeNull();
  });
});
