/**
 * tests/e2e/frontend-ui-variant-walk.test.ts
 *
 * E2E tests for the frontend-ui pipeline variant (BRE-353).
 *
 * Verifies:
 *   - TEST-N01 fixture has correct structure (13-phase frontend-ui pipeline)
 *   - Every transition in the happy path is wired correctly
 *   - Key difference from backend: run_tests → visual_verify → blindqa
 *   - Error/failure self-loops and escalation work
 *   - Full pipeline walk from clarify → done
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveTransition } from "../../minds/pipeline_core/transitions";

// ── Fixture paths ────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(import.meta.dir, "fixtures/TEST-N01");

// ── Load once ────────────────────────────────────────────────────────────────

const pipeline = JSON.parse(readFileSync(join(FIXTURE_DIR, "pipeline.json"), "utf-8"));
const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected.json"), "utf-8"));
const stubs = JSON.parse(readFileSync(join(FIXTURE_DIR, "stub-signals.json"), "utf-8"));

// ── TEST-N01 fixture validation ──────────────────────────────────────────────

describe("e2e/TEST-N01: fixture structure", () => {
  test("1. pipeline.json has 14 phases (13 + escalate terminal)", () => {
    const phaseIds = Object.keys(pipeline.phases);
    expect(phaseIds.length).toBe(14);
  });

  test("2. expected.json has 13-phase happy path", () => {
    expect(expected.length).toBe(13);
    expect(expected[0]).toBe("clarify");
    expect(expected[expected.length - 1]).toBe("done");
  });

  test("3. stub-signals.json has 12 triggers (one per non-terminal phase)", () => {
    expect(stubs.length).toBe(12);
  });

  test("4. version is 3.1", () => {
    expect(pipeline.version).toBe("3.1");
  });

  test("5. done and escalate are both terminal", () => {
    expect(pipeline.phases.done.terminal).toBe(true);
    expect(pipeline.phases.escalate.terminal).toBe(true);
  });
});

// ── Happy path transitions ───────────────────────────────────────────────────

describe("e2e/frontend-ui-variant: happy path transitions", () => {
  test("6. clarify → spec_critique on CLARIFY_COMPLETE", () => {
    const t = resolveTransition("clarify", "CLARIFY_COMPLETE", pipeline);
    expect(t!.to).toBe("spec_critique");
  });

  test("7. spec_critique → plan on SPEC_CRITIQUE_COMPLETE", () => {
    const t = resolveTransition("spec_critique", "SPEC_CRITIQUE_COMPLETE", pipeline);
    expect(t!.to).toBe("plan");
  });

  test("8. plan → plan_review on PLAN_COMPLETE", () => {
    const t = resolveTransition("plan", "PLAN_COMPLETE", pipeline);
    expect(t!.to).toBe("plan_review");
  });

  test("9. plan_review → tasks on PLAN_REVIEW_APPROVED", () => {
    const t = resolveTransition("plan_review", "PLAN_REVIEW_APPROVED", pipeline);
    expect(t!.to).toBe("tasks");
  });

  test("10. tasks → analyze on TASKS_COMPLETE", () => {
    const t = resolveTransition("tasks", "TASKS_COMPLETE", pipeline);
    expect(t!.to).toBe("analyze");
  });

  test("11. analyze → analyze_review on ANALYZE_COMPLETE", () => {
    const t = resolveTransition("analyze", "ANALYZE_COMPLETE", pipeline);
    expect(t!.to).toBe("analyze_review");
  });

  test("12. analyze_review → implement on ANALYZE_REVIEW_APPROVED", () => {
    const t = resolveTransition("analyze_review", "ANALYZE_REVIEW_APPROVED", pipeline);
    expect(t!.to).toBe("implement");
  });

  test("13. implement → codeReview on IMPLEMENT_COMPLETE", () => {
    const t = resolveTransition("implement", "IMPLEMENT_COMPLETE", pipeline);
    expect(t!.to).toBe("codeReview");
  });

  test("14. codeReview → run_tests on CODE_REVIEW_PASS", () => {
    const t = resolveTransition("codeReview", "CODE_REVIEW_PASS", pipeline);
    expect(t!.to).toBe("run_tests");
  });

  test("15. run_tests → visual_verify on RUN_TESTS_COMPLETE (key diff from backend)", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_COMPLETE", pipeline);
    expect(t!.to).toBe("visual_verify");
  });

  test("16. visual_verify → blindqa on VISUAL_VERIFY_COMPLETE", () => {
    const t = resolveTransition("visual_verify", "VISUAL_VERIFY_COMPLETE", pipeline);
    expect(t!.to).toBe("blindqa");
  });

  test("17. blindqa → done on BLINDQA_COMPLETE", () => {
    const t = resolveTransition("blindqa", "BLINDQA_COMPLETE", pipeline);
    expect(t!.to).toBe("done");
  });
});

// ── Error/failure routing ────────────────────────────────────────────────────

describe("e2e/frontend-ui-variant: error and failure routing", () => {
  test("18. SPEC_CRITIQUE_BLOCKED → clarify", () => {
    const t = resolveTransition("spec_critique", "SPEC_CRITIQUE_BLOCKED", pipeline);
    expect(t!.to).toBe("clarify");
  });

  test("19. PLAN_REVIEW_REJECTED → plan", () => {
    const t = resolveTransition("plan_review", "PLAN_REVIEW_REJECTED", pipeline);
    expect(t!.to).toBe("plan");
  });

  test("20. ANALYZE_REVIEW_REJECTED → analyze", () => {
    const t = resolveTransition("analyze_review", "ANALYZE_REVIEW_REJECTED", pipeline);
    expect(t!.to).toBe("analyze");
  });

  test("21. IMPLEMENT_ERROR → implement (self-loop)", () => {
    const t = resolveTransition("implement", "IMPLEMENT_ERROR", pipeline);
    expect(t!.to).toBe("implement");
  });

  test("22. CODE_REVIEW_FAIL → implement", () => {
    const t = resolveTransition("codeReview", "CODE_REVIEW_FAIL", pipeline);
    expect(t!.to).toBe("implement");
  });

  test("23. RUN_TESTS_FAILED → run_tests (self-loop)", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_FAILED", pipeline);
    expect(t!.to).toBe("run_tests");
  });

  test("24. RUN_TESTS_ERROR → escalate (no auto-retry)", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_ERROR", pipeline);
    expect(t!.to).toBe("escalate");
  });

  test("25. VISUAL_VERIFY_FAILED → visual_verify (self-loop)", () => {
    const t = resolveTransition("visual_verify", "VISUAL_VERIFY_FAILED", pipeline);
    expect(t!.to).toBe("visual_verify");
  });

  test("26. VISUAL_VERIFY_ERROR → escalate (no auto-retry)", () => {
    const t = resolveTransition("visual_verify", "VISUAL_VERIFY_ERROR", pipeline);
    expect(t!.to).toBe("escalate");
  });

  test("27. BLINDQA_FAILED → implement", () => {
    const t = resolveTransition("blindqa", "BLINDQA_FAILED", pipeline);
    expect(t!.to).toBe("implement");
  });
});

// ── Full pipeline walk ───────────────────────────────────────────────────────

describe("e2e/frontend-ui-variant: full pipeline walk", () => {
  test("28. walk happy path: 13 phases from clarify to done", () => {
    const visited: string[] = [];
    let current = Object.keys(pipeline.phases)[0];

    const happySignals: Record<string, string> = {
      clarify: "CLARIFY_COMPLETE",
      spec_critique: "SPEC_CRITIQUE_COMPLETE",
      plan: "PLAN_COMPLETE",
      plan_review: "PLAN_REVIEW_APPROVED",
      tasks: "TASKS_COMPLETE",
      analyze: "ANALYZE_COMPLETE",
      analyze_review: "ANALYZE_REVIEW_APPROVED",
      implement: "IMPLEMENT_COMPLETE",
      codeReview: "CODE_REVIEW_PASS",
      run_tests: "RUN_TESTS_COMPLETE",
      visual_verify: "VISUAL_VERIFY_COMPLETE",
      blindqa: "BLINDQA_COMPLETE",
    };

    while (!pipeline.phases[current]?.terminal) {
      visited.push(current);
      const signal = happySignals[current];
      expect(signal).toBeTruthy();

      const t = resolveTransition(current, signal, pipeline);
      expect(t).not.toBeNull();
      expect(t!.to).toBeTruthy();
      current = t!.to!;
    }
    visited.push(current);

    expect(visited).toEqual(expected);
  });

  test("29. all to: targets reference phases that exist", () => {
    const phaseNames = new Set(Object.keys(pipeline.phases));
    for (const [phaseName, phase] of Object.entries(pipeline.phases) as [string, any][]) {
      if (phase.terminal) continue;
      for (const [signal, transition] of Object.entries(phase.transitions ?? {}) as [string, any][]) {
        expect(
          phaseNames.has(transition.to),
          `Phase '${phaseName}' signal '${signal}' targets non-existent phase '${transition.to}'`
        ).toBe(true);
      }
    }
  });

  test("30. frontend-ui has visual_verify but backend does not", () => {
    const backendPipeline = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/TEST-M01/pipeline.json"), "utf-8")
    );

    // Frontend-ui has visual_verify
    expect(pipeline.phases.visual_verify).toBeDefined();
    // Backend does not
    expect(backendPipeline.phases.visual_verify).toBeUndefined();

    // Frontend: run_tests → visual_verify
    const feT = resolveTransition("run_tests", "RUN_TESTS_COMPLETE", pipeline);
    expect(feT!.to).toBe("visual_verify");

    // Backend: run_tests → blindqa
    const beT = resolveTransition("run_tests", "RUN_TESTS_COMPLETE", backendPipeline);
    expect(beT!.to).toBe("blindqa");
  });
});
