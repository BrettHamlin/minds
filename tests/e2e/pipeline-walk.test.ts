/**
 * tests/e2e/pipeline-walk.test.ts
 *
 * Category 6: Full Pipeline Walk — verifies the complete clarify→done happy
 * path using the compiled collab.pipeline and the orchestrator's routing
 * functions.
 *
 * Simulates how the orchestrator routes each phase signal:
 *   - Direct transitions via resolveTransition
 *   - Conditional transitions (implement) via resolveConditionalTransition
 *   - Gate transitions via resolveGateResponse
 *
 * Uses the real collab.pipeline as input.
 */

import { describe, test, expect } from "bun:test";
import {
  resolveTransition,
  resolveConditionalTransition,
  resolveGateResponse,
} from "../../src/lib/pipeline/transitions";
import { resolvePhaseCommand } from "../../src/scripts/orchestrator/commands/phase-dispatch";
import { compileCollab } from "./helpers";

// ── Compile once ──────────────────────────────────────────────────────────────

const compiled = compileCollab();

// ── Happy path: step-by-step ──────────────────────────────────────────────────

describe("e2e/pipeline-walk: happy path clarify → done", () => {
  test("1. clarify + CLARIFY_COMPLETE → advance to plan", () => {
    const t = resolveTransition("clarify", "CLARIFY_COMPLETE", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("plan");
    expect(t!.gate).toBeNull();
  });

  test("2. plan + PLAN_COMPLETE → gate plan_review → APPROVED → tasks", () => {
    const t = resolveTransition("plan", "PLAN_COMPLETE", compiled);
    expect(t).not.toBeNull();
    expect(t!.gate).toBe("plan_review");

    const gate = compiled.gates!["plan_review"];
    const resp = resolveGateResponse("plan_review", gate, "APPROVED", 0);
    if (!("nextPhase" in resp)) throw new Error("Expected nextPhase");
    expect(resp.nextPhase).toBe("tasks");
  });

  test("3. tasks + TASKS_COMPLETE → advance to analyze", () => {
    const t = resolveTransition("tasks", "TASKS_COMPLETE", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("analyze");
    expect(t!.gate).toBeNull();
  });

  test("4. analyze + ANALYZE_COMPLETE → gate analyze_review → REMEDIATION_COMPLETE → implement", () => {
    const t = resolveTransition("analyze", "ANALYZE_COMPLETE", compiled);
    expect(t).not.toBeNull();
    expect(t!.gate).toBe("analyze_review");

    const gate = compiled.gates!["analyze_review"];
    const resp = resolveGateResponse("analyze_review", gate, "REMEDIATION_COMPLETE", 0);
    if (!("nextPhase" in resp)) throw new Error("Expected nextPhase");
    expect(resp.nextPhase).toBe("implement");
  });

  test("5. implement + IMPLEMENT_COMPLETE (otherwise) → advance to blindqa", () => {
    const rows = compiled.phases["implement"].conditionalTransitions ?? [];
    const t = resolveConditionalTransition(rows, "IMPLEMENT_COMPLETE");
    expect(t).not.toBeNull();
    expect(t).toEqual({ to: "blindqa" });
  });

  test("6. blindqa + BLINDQA_COMPLETE → advance to done", () => {
    const t = resolveTransition("blindqa", "BLINDQA_COMPLETE", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("done");
    expect(t!.gate).toBeNull();
  });

  test("7. done is terminal — resolvePhaseCommand returns null", () => {
    const result = resolvePhaseCommand(compiled, "done");
    expect(result).toBeNull();
  });

  test("8. full happy-path walk visits exactly 7 phases ending at done", () => {
    // Simulate the orchestrator routing through the entire pipeline.
    // At each step we call the appropriate routing function and advance.
    const visited: string[] = ["clarify"];
    let current = "clarify";

    // Step 1: clarify → plan
    {
      const t = resolveTransition(current, "CLARIFY_COMPLETE", compiled)!;
      current = t.to!;
      visited.push(current);
    }

    // Step 2: plan → (gate) → tasks
    {
      const t = resolveTransition(current, "PLAN_COMPLETE", compiled)!;
      const gate = compiled.gates![t.gate!];
      const resp = resolveGateResponse(t.gate!, gate, "APPROVED", 0);
      if (!("nextPhase" in resp)) throw new Error("Expected nextPhase");
      current = resp.nextPhase;
      visited.push(current);
    }

    // Step 3: tasks → analyze
    {
      const t = resolveTransition(current, "TASKS_COMPLETE", compiled)!;
      current = t.to!;
      visited.push(current);
    }

    // Step 4: analyze → (gate) → implement
    {
      const t = resolveTransition(current, "ANALYZE_COMPLETE", compiled)!;
      const gate = compiled.gates![t.gate!];
      const resp = resolveGateResponse(t.gate!, gate, "REMEDIATION_COMPLETE", 0);
      if (!("nextPhase" in resp)) throw new Error("Expected nextPhase");
      current = resp.nextPhase;
      visited.push(current);
    }

    // Step 5: implement → blindqa (otherwise branch)
    {
      const rows = compiled.phases[current].conditionalTransitions ?? [];
      const t = resolveConditionalTransition(rows, "IMPLEMENT_COMPLETE")!;
      current = t.to!;
      visited.push(current);
    }

    // Step 6: blindqa → done
    {
      const t = resolveTransition(current, "BLINDQA_COMPLETE", compiled)!;
      current = t.to!;
      visited.push(current);
    }

    expect(visited).toEqual(["clarify", "plan", "tasks", "analyze", "implement", "blindqa", "done"]);
    expect(compiled.phases[current].terminal).toBe(true);
  });
});

// ── Gate retry / exhaust paths ────────────────────────────────────────────────

describe("e2e/pipeline-walk: gate retry and exhaust paths", () => {
  test("9. plan_review: REVISION_NEEDED (0 retries) → back to plan", () => {
    const gate = compiled.gates!["plan_review"];
    const resp = resolveGateResponse("plan_review", gate, "REVISION_NEEDED", 0);
    if (!("nextPhase" in resp)) throw new Error("Expected nextPhase");
    expect(resp.nextPhase).toBe("plan");
  });

  test("10. plan_review: REVISION_NEEDED (3 retries = maxRetries) → exhausted → skipTo tasks", () => {
    const gate = compiled.gates!["plan_review"];
    // maxRetries is 3 — after 3 failed attempts (retriesSoFar=3), exhausted
    const resp = resolveGateResponse("plan_review", gate, "REVISION_NEEDED", 3);
    if (!("nextPhase" in resp)) throw new Error("Expected nextPhase");
    expect(resp.nextPhase).toBe("tasks"); // skipTo: tasks
  });

  test("11. plan_review: APPROVED has no maxRetries field", () => {
    const gate = compiled.gates!["plan_review"];
    expect(gate.on["APPROVED"].maxRetries).toBeUndefined();
  });

  test("12. analyze_review: ESCALATION → onExhaust abort → error result", () => {
    const gate = compiled.gates!["analyze_review"];
    const resp = resolveGateResponse("analyze_review", gate, "ESCALATION", 0);
    if (!("error" in resp)) throw new Error("Expected error");
    expect(resp.error).toContain("onExhaust: abort");
  });

  test("13. analyze_review: REMEDIATION_COMPLETE has no maxRetries", () => {
    const gate = compiled.gates!["analyze_review"];
    const resp = resolveGateResponse("analyze_review", gate, "REMEDIATION_COMPLETE", 0);
    if (!("nextPhase" in resp)) throw new Error("Expected nextPhase");
    expect(resp.nextPhase).toBe("implement");
  });

  test("14. plan_review: unknown signal → error result", () => {
    const gate = compiled.gates!["plan_review"];
    const resp = resolveGateResponse("plan_review", gate, "UNKNOWN_SIGNAL", 0);
    expect("error" in resp).toBe(true);
  });
});

// ── Error self-loop paths ─────────────────────────────────────────────────────

describe("e2e/pipeline-walk: error self-loop paths", () => {
  test("15. plan + PLAN_ERROR → back to plan", () => {
    const t = resolveTransition("plan", "PLAN_ERROR", compiled);
    expect(t!.to).toBe("plan");
  });

  test("16. tasks + TASKS_ERROR → back to tasks", () => {
    const t = resolveTransition("tasks", "TASKS_ERROR", compiled);
    expect(t!.to).toBe("tasks");
  });

  test("17. analyze + ANALYZE_ERROR → back to analyze", () => {
    const t = resolveTransition("analyze", "ANALYZE_ERROR", compiled);
    expect(t!.to).toBe("analyze");
  });

  test("18. implement + IMPLEMENT_ERROR → back to implement", () => {
    const t = resolveTransition("implement", "IMPLEMENT_ERROR", compiled);
    expect(t!.to).toBe("implement");
  });

  test("19. blindqa + BLINDQA_FAILED → back to blindqa", () => {
    const t = resolveTransition("blindqa", "BLINDQA_FAILED", compiled);
    expect(t!.to).toBe("blindqa");
  });

  test("20. blindqa + BLINDQA_ERROR → back to blindqa", () => {
    const t = resolveTransition("blindqa", "BLINDQA_ERROR", compiled);
    expect(t!.to).toBe("blindqa");
  });
});
