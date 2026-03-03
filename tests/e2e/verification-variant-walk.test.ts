/**
 * tests/e2e/verification-variant-walk.test.ts
 *
 * E2E tests for the verification pipeline variant (BRE-354).
 *
 * Verifies:
 *   - TEST-O01a fixture: happy path (clarify → verify_execute → done)
 *   - TEST-O01b fixture: failure self-loop then success
 *   - Error routing to escalate terminal
 *   - Full pipeline walks for both fixtures
 *   - Cross-variant comparison: verification is shortest variant
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveTransition } from "../../src/lib/pipeline/transitions";

// ── Fixture paths ────────────────────────────────────────────────────────────

const FIXTURE_A = join(import.meta.dir, "fixtures/TEST-O01a");
const FIXTURE_B = join(import.meta.dir, "fixtures/TEST-O01b");

// ── Load once ────────────────────────────────────────────────────────────────

const pipelineA = JSON.parse(readFileSync(join(FIXTURE_A, "pipeline.json"), "utf-8"));
const expectedA = JSON.parse(readFileSync(join(FIXTURE_A, "expected.json"), "utf-8"));
const stubsA = JSON.parse(readFileSync(join(FIXTURE_A, "stub-signals.json"), "utf-8"));

const pipelineB = JSON.parse(readFileSync(join(FIXTURE_B, "pipeline.json"), "utf-8"));
const expectedB = JSON.parse(readFileSync(join(FIXTURE_B, "expected.json"), "utf-8"));
const stubsB = JSON.parse(readFileSync(join(FIXTURE_B, "stub-signals.json"), "utf-8"));

// ── TEST-O01a fixture validation (happy path) ───────────────────────────────

describe("e2e/TEST-O01a: fixture structure (happy path)", () => {
  test("1. pipeline.json has 4 phases (2 active + 2 terminal)", () => {
    const phaseIds = Object.keys(pipelineA.phases);
    expect(phaseIds.length).toBe(4);
  });

  test("2. expected.json has 3-phase happy path", () => {
    expect(expectedA.length).toBe(3);
    expect(expectedA[0]).toBe("clarify");
    expect(expectedA[1]).toBe("verify_execute");
    expect(expectedA[expectedA.length - 1]).toBe("done");
  });

  test("3. stub-signals.json has 2 triggers (one per non-terminal phase)", () => {
    expect(stubsA.length).toBe(2);
  });

  test("4. version is 3.1", () => {
    expect(pipelineA.version).toBe("3.1");
  });

  test("5. done and escalate are both terminal", () => {
    expect(pipelineA.phases.done.terminal).toBe(true);
    expect(pipelineA.phases.escalate.terminal).toBe(true);
  });
});

// ── TEST-O01b fixture validation (failure → rerun) ──────────────────────────

describe("e2e/TEST-O01b: fixture structure (failure → rerun)", () => {
  test("6. pipeline.json matches O01a (same config)", () => {
    expect(pipelineB).toEqual(pipelineA);
  });

  test("7. expected.json has 4-phase path (verify_execute visited twice)", () => {
    expect(expectedB.length).toBe(4);
    expect(expectedB).toEqual(["clarify", "verify_execute", "verify_execute", "done"]);
  });

  test("8. stub-signals.json has 3 triggers (fail then succeed)", () => {
    expect(stubsB.length).toBe(3);
    expect(stubsB[1].signal).toBe("VERIFY_EXECUTE_FAILED");
    expect(stubsB[2].signal).toBe("VERIFY_EXECUTE_COMPLETE");
  });
});

// ── Happy path transitions ───────────────────────────────────────────────────

describe("e2e/verification-variant: happy path transitions", () => {
  test("9. clarify → verify_execute on CLARIFY_COMPLETE", () => {
    const t = resolveTransition("clarify", "CLARIFY_COMPLETE", pipelineA);
    expect(t!.to).toBe("verify_execute");
  });

  test("10. verify_execute → done on VERIFY_EXECUTE_COMPLETE", () => {
    const t = resolveTransition("verify_execute", "VERIFY_EXECUTE_COMPLETE", pipelineA);
    expect(t!.to).toBe("done");
  });
});

// ── Error/failure routing ────────────────────────────────────────────────────

describe("e2e/verification-variant: error and failure routing", () => {
  test("11. VERIFY_EXECUTE_FAILED → verify_execute (self-loop)", () => {
    const t = resolveTransition("verify_execute", "VERIFY_EXECUTE_FAILED", pipelineA);
    expect(t!.to).toBe("verify_execute");
  });

  test("12. VERIFY_EXECUTE_ERROR → escalate (no auto-retry)", () => {
    const t = resolveTransition("verify_execute", "VERIFY_EXECUTE_ERROR", pipelineA);
    expect(t!.to).toBe("escalate");
  });
});

// ── Full pipeline walk (happy path) ─────────────────────────────────────────

describe("e2e/verification-variant: full pipeline walk", () => {
  test("13. walk happy path: 3 phases from clarify to done", () => {
    const visited: string[] = [];
    let current = Object.keys(pipelineA.phases)[0];

    const happySignals: Record<string, string> = {
      clarify: "CLARIFY_COMPLETE",
      verify_execute: "VERIFY_EXECUTE_COMPLETE",
    };

    while (!pipelineA.phases[current]?.terminal) {
      visited.push(current);
      const signal = happySignals[current];
      expect(signal).toBeTruthy();

      const t = resolveTransition(current, signal, pipelineA);
      expect(t).not.toBeNull();
      expect(t!.to).toBeTruthy();
      current = t!.to!;
    }
    visited.push(current);

    expect(visited).toEqual(expectedA);
  });

  test("14. walk failure-then-success: verify_execute visited twice", () => {
    const visited: string[] = [];
    let current = Object.keys(pipelineB.phases)[0];

    // Simulate: clarify → COMPLETE, verify_execute → FAILED, verify_execute → COMPLETE
    const signalSequence = [
      { phase: "clarify", signal: "CLARIFY_COMPLETE" },
      { phase: "verify_execute", signal: "VERIFY_EXECUTE_FAILED" },
      { phase: "verify_execute", signal: "VERIFY_EXECUTE_COMPLETE" },
    ];

    let stepIdx = 0;
    while (!pipelineB.phases[current]?.terminal) {
      visited.push(current);
      const step = signalSequence[stepIdx];
      expect(step).toBeTruthy();
      expect(step.phase).toBe(current);

      const t = resolveTransition(current, step.signal, pipelineB);
      expect(t).not.toBeNull();
      expect(t!.to).toBeTruthy();
      current = t!.to!;
      stepIdx++;
    }
    visited.push(current);

    expect(visited).toEqual(expectedB);
  });

  test("15. all to: targets reference phases that exist", () => {
    const phaseNames = new Set(Object.keys(pipelineA.phases));
    for (const [phaseName, phase] of Object.entries(pipelineA.phases) as [string, any][]) {
      if (phase.terminal) continue;
      for (const [signal, transition] of Object.entries(phase.transitions ?? {}) as [string, any][]) {
        expect(
          phaseNames.has(transition.to),
          `Phase '${phaseName}' signal '${signal}' targets non-existent phase '${transition.to}'`
        ).toBe(true);
      }
    }
  });

  test("16. every non-terminal phase has a command", () => {
    for (const [name, phase] of Object.entries(pipelineA.phases) as [string, any][]) {
      if (phase.terminal) continue;
      expect(phase.command, `Phase '${name}' missing command`).toBeTruthy();
    }
  });
});

// ── Cross-variant comparison ────────────────────────────────────────────────

describe("e2e/verification-variant: cross-variant comparison", () => {
  test("17. verification is shortest variant (fewer phases than backend)", () => {
    const backendPipeline = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/TEST-M01/pipeline.json"), "utf-8")
    );

    const verificationPhaseCount = Object.keys(pipelineA.phases).length;
    const backendPhaseCount = Object.keys(backendPipeline.phases).length;

    expect(verificationPhaseCount).toBeLessThan(backendPhaseCount);
  });

  test("18. verification has no implement, plan, tasks, or blindqa phases", () => {
    expect(pipelineA.phases.implement).toBeUndefined();
    expect(pipelineA.phases.plan).toBeUndefined();
    expect(pipelineA.phases.tasks).toBeUndefined();
    expect(pipelineA.phases.blindqa).toBeUndefined();
  });

  test("19. verification and backend both have clarify and done", () => {
    const backendPipeline = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/TEST-M01/pipeline.json"), "utf-8")
    );

    expect(pipelineA.phases.clarify).toBeDefined();
    expect(pipelineA.phases.done).toBeDefined();
    expect(backendPipeline.phases.clarify).toBeDefined();
    expect(backendPipeline.phases.done).toBeDefined();
  });

  test("20. verification and backend both have escalate terminal", () => {
    const backendPipeline = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/TEST-M01/pipeline.json"), "utf-8")
    );

    expect(pipelineA.phases.escalate.terminal).toBe(true);
    expect(backendPipeline.phases.escalate.terminal).toBe(true);
  });
});
