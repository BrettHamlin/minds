/**
 * tests/e2e/deploy-variant-walk.test.ts
 *
 * E2E tests for the deploy pipeline variant (BRE-355).
 *
 * Verifies:
 *   - TEST-P01a fixture: happy path (13 active phases + done)
 *   - TEST-P01b fixture: deploy failure → fix-forward → retry → done
 *   - pre_deploy_confirm gate between blindqa and deploy_verify
 *   - deploy_human_gate with 3 decision signals
 *   - Full pipeline walks for both fixtures
 *   - Cross-variant comparison with backend
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveTransition } from "../../minds/pipeline_core/transitions";

// ── Fixture paths ────────────────────────────────────────────────────────────

const FIXTURE_A = join(import.meta.dir, "fixtures/TEST-P01a");
const FIXTURE_B = join(import.meta.dir, "fixtures/TEST-P01b");

// ── Load once ────────────────────────────────────────────────────────────────

const pipelineA = JSON.parse(readFileSync(join(FIXTURE_A, "pipeline.json"), "utf-8"));
const expectedA = JSON.parse(readFileSync(join(FIXTURE_A, "expected.json"), "utf-8"));
const stubsA = JSON.parse(readFileSync(join(FIXTURE_A, "stub-signals.json"), "utf-8"));

const pipelineB = JSON.parse(readFileSync(join(FIXTURE_B, "pipeline.json"), "utf-8"));
const expectedB = JSON.parse(readFileSync(join(FIXTURE_B, "expected.json"), "utf-8"));
const stubsB = JSON.parse(readFileSync(join(FIXTURE_B, "stub-signals.json"), "utf-8"));

// ── TEST-P01a fixture validation (happy path) ───────────────────────────────

describe("e2e/TEST-P01a: fixture structure (happy path)", () => {
  test("1. pipeline.json has 16 phases (13 active + deploy_human_gate + 2 terminal)", () => {
    const phaseIds = Object.keys(pipelineA.phases);
    expect(phaseIds.length).toBe(16);
  });

  test("2. expected.json has 14-phase happy path", () => {
    expect(expectedA.length).toBe(14);
    expect(expectedA[0]).toBe("clarify");
    expect(expectedA[expectedA.length - 1]).toBe("done");
  });

  test("3. stub-signals.json has 13 triggers (one per happy-path non-terminal phase)", () => {
    expect(stubsA.length).toBe(13);
  });

  test("4. version is 3.1", () => {
    expect(pipelineA.version).toBe("3.1");
  });

  test("5. done and escalate are both terminal", () => {
    expect(pipelineA.phases.done.terminal).toBe(true);
    expect(pipelineA.phases.escalate.terminal).toBe(true);
  });
});

// ── TEST-P01b fixture validation (failure → fix-forward) ────────────────────

describe("e2e/TEST-P01b: fixture structure (failure → fix-forward)", () => {
  test("6. pipeline.json matches P01a (same config)", () => {
    expect(pipelineB).toEqual(pipelineA);
  });

  test("7. expected.json has 21-phase path (fix-forward loop)", () => {
    expect(expectedB.length).toBe(21);
    expect(expectedB).toEqual([
      "clarify", "spec_critique", "plan", "plan_review", "tasks",
      "analyze", "analyze_review", "implement", "codeReview", "run_tests",
      "blindqa", "pre_deploy_confirm", "deploy_verify",
      "deploy_human_gate", "implement", "codeReview", "run_tests",
      "blindqa", "pre_deploy_confirm", "deploy_verify", "done",
    ]);
  });

  test("8. stub-signals.json has 20 triggers (includes failure + fix-forward loop)", () => {
    expect(stubsB.length).toBe(20);
    expect(stubsB[12].signal).toBe("DEPLOY_VERIFY_FAILED");
    expect(stubsB[13].signal).toBe("DEPLOY_FIX_FORWARD");
    expect(stubsB[19].signal).toBe("DEPLOY_VERIFY_COMPLETE");
  });
});

// ── Happy path transitions ───────────────────────────────────────────────────

describe("e2e/deploy-variant: happy path transitions", () => {
  test("9. clarify → spec_critique on CLARIFY_COMPLETE", () => {
    const t = resolveTransition("clarify", "CLARIFY_COMPLETE", pipelineA);
    expect(t!.to).toBe("spec_critique");
  });

  test("10. spec_critique → plan on SPEC_CRITIQUE_COMPLETE", () => {
    const t = resolveTransition("spec_critique", "SPEC_CRITIQUE_COMPLETE", pipelineA);
    expect(t!.to).toBe("plan");
  });

  test("11. plan → plan_review on PLAN_COMPLETE", () => {
    const t = resolveTransition("plan", "PLAN_COMPLETE", pipelineA);
    expect(t!.to).toBe("plan_review");
  });

  test("12. plan_review → tasks on PLAN_REVIEW_APPROVED", () => {
    const t = resolveTransition("plan_review", "PLAN_REVIEW_APPROVED", pipelineA);
    expect(t!.to).toBe("tasks");
  });

  test("13. tasks → analyze on TASKS_COMPLETE", () => {
    const t = resolveTransition("tasks", "TASKS_COMPLETE", pipelineA);
    expect(t!.to).toBe("analyze");
  });

  test("14. analyze → analyze_review on ANALYZE_COMPLETE", () => {
    const t = resolveTransition("analyze", "ANALYZE_COMPLETE", pipelineA);
    expect(t!.to).toBe("analyze_review");
  });

  test("15. analyze_review → implement on ANALYZE_REVIEW_APPROVED", () => {
    const t = resolveTransition("analyze_review", "ANALYZE_REVIEW_APPROVED", pipelineA);
    expect(t!.to).toBe("implement");
  });

  test("16. implement → codeReview on IMPLEMENT_COMPLETE", () => {
    const t = resolveTransition("implement", "IMPLEMENT_COMPLETE", pipelineA);
    expect(t!.to).toBe("codeReview");
  });

  test("17. codeReview → run_tests on CODE_REVIEW_PASS", () => {
    const t = resolveTransition("codeReview", "CODE_REVIEW_PASS", pipelineA);
    expect(t!.to).toBe("run_tests");
  });

  test("18. run_tests → blindqa on RUN_TESTS_COMPLETE", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_COMPLETE", pipelineA);
    expect(t!.to).toBe("blindqa");
  });

  test("19. blindqa → pre_deploy_confirm on BLINDQA_COMPLETE (key diff from backend)", () => {
    const t = resolveTransition("blindqa", "BLINDQA_COMPLETE", pipelineA);
    expect(t!.to).toBe("pre_deploy_confirm");
  });

  test("20. pre_deploy_confirm → deploy_verify on PRE_DEPLOY_CONFIRM_COMPLETE", () => {
    const t = resolveTransition("pre_deploy_confirm", "PRE_DEPLOY_CONFIRM_COMPLETE", pipelineA);
    expect(t!.to).toBe("deploy_verify");
  });

  test("21. deploy_verify → done on DEPLOY_VERIFY_COMPLETE", () => {
    const t = resolveTransition("deploy_verify", "DEPLOY_VERIFY_COMPLETE", pipelineA);
    expect(t!.to).toBe("done");
  });
});

// ── Error/failure routing ────────────────────────────────────────────────────

describe("e2e/deploy-variant: error and failure routing", () => {
  test("22. SPEC_CRITIQUE_BLOCKED → clarify", () => {
    const t = resolveTransition("spec_critique", "SPEC_CRITIQUE_BLOCKED", pipelineA);
    expect(t!.to).toBe("clarify");
  });

  test("23. PLAN_REVIEW_REJECTED → plan", () => {
    const t = resolveTransition("plan_review", "PLAN_REVIEW_REJECTED", pipelineA);
    expect(t!.to).toBe("plan");
  });

  test("24. ANALYZE_REVIEW_REJECTED → analyze", () => {
    const t = resolveTransition("analyze_review", "ANALYZE_REVIEW_REJECTED", pipelineA);
    expect(t!.to).toBe("analyze");
  });

  test("25. IMPLEMENT_ERROR → implement (self-loop)", () => {
    const t = resolveTransition("implement", "IMPLEMENT_ERROR", pipelineA);
    expect(t!.to).toBe("implement");
  });

  test("26. CODE_REVIEW_FAIL → implement", () => {
    const t = resolveTransition("codeReview", "CODE_REVIEW_FAIL", pipelineA);
    expect(t!.to).toBe("implement");
  });

  test("27. RUN_TESTS_FAILED → run_tests (self-loop)", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_FAILED", pipelineA);
    expect(t!.to).toBe("run_tests");
  });

  test("28. RUN_TESTS_ERROR → escalate", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_ERROR", pipelineA);
    expect(t!.to).toBe("escalate");
  });

  test("29. BLINDQA_FAILED → implement", () => {
    const t = resolveTransition("blindqa", "BLINDQA_FAILED", pipelineA);
    expect(t!.to).toBe("implement");
  });

  test("30. PRE_DEPLOY_CONFIRM_FAILED → pre_deploy_confirm (self-loop)", () => {
    const t = resolveTransition("pre_deploy_confirm", "PRE_DEPLOY_CONFIRM_FAILED", pipelineA);
    expect(t!.to).toBe("pre_deploy_confirm");
  });

  test("31. PRE_DEPLOY_CONFIRM_ERROR → escalate", () => {
    const t = resolveTransition("pre_deploy_confirm", "PRE_DEPLOY_CONFIRM_ERROR", pipelineA);
    expect(t!.to).toBe("escalate");
  });

  test("32. DEPLOY_VERIFY_FAILED → deploy_human_gate", () => {
    const t = resolveTransition("deploy_verify", "DEPLOY_VERIFY_FAILED", pipelineA);
    expect(t!.to).toBe("deploy_human_gate");
  });

  test("33. DEPLOY_VERIFY_ERROR → deploy_human_gate", () => {
    const t = resolveTransition("deploy_verify", "DEPLOY_VERIFY_ERROR", pipelineA);
    expect(t!.to).toBe("deploy_human_gate");
  });
});

// ── deploy_human_gate decision routing ──────────────────────────────────────

describe("e2e/deploy-variant: deploy_human_gate decisions", () => {
  test("34. DEPLOY_FIX_FORWARD → implement", () => {
    const t = resolveTransition("deploy_human_gate", "DEPLOY_FIX_FORWARD", pipelineA);
    expect(t!.to).toBe("implement");
  });

  test("35. DEPLOY_ROLLBACK → escalate", () => {
    const t = resolveTransition("deploy_human_gate", "DEPLOY_ROLLBACK", pipelineA);
    expect(t!.to).toBe("escalate");
  });

  test("36. DEPLOY_INVESTIGATE → escalate", () => {
    const t = resolveTransition("deploy_human_gate", "DEPLOY_INVESTIGATE", pipelineA);
    expect(t!.to).toBe("escalate");
  });
});

// ── Full pipeline walks ─────────────────────────────────────────────────────

describe("e2e/deploy-variant: full pipeline walk", () => {
  test("37. walk happy path: 14 phases from clarify to done", () => {
    const visited: string[] = [];
    let current = Object.keys(pipelineA.phases)[0];

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
      blindqa: "BLINDQA_COMPLETE",
      pre_deploy_confirm: "PRE_DEPLOY_CONFIRM_COMPLETE",
      deploy_verify: "DEPLOY_VERIFY_COMPLETE",
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

  test("38. walk failure-then-fix-forward: deploy_verify fails, loops through implement", () => {
    const visited: string[] = [];
    let current = Object.keys(pipelineB.phases)[0];

    // Signal sequence matches TEST-P01b stub-signals
    const signalSequence = [
      { phase: "clarify", signal: "CLARIFY_COMPLETE" },
      { phase: "spec_critique", signal: "SPEC_CRITIQUE_COMPLETE" },
      { phase: "plan", signal: "PLAN_COMPLETE" },
      { phase: "plan_review", signal: "PLAN_REVIEW_APPROVED" },
      { phase: "tasks", signal: "TASKS_COMPLETE" },
      { phase: "analyze", signal: "ANALYZE_COMPLETE" },
      { phase: "analyze_review", signal: "ANALYZE_REVIEW_APPROVED" },
      { phase: "implement", signal: "IMPLEMENT_COMPLETE" },
      { phase: "codeReview", signal: "CODE_REVIEW_PASS" },
      { phase: "run_tests", signal: "RUN_TESTS_COMPLETE" },
      { phase: "blindqa", signal: "BLINDQA_COMPLETE" },
      { phase: "pre_deploy_confirm", signal: "PRE_DEPLOY_CONFIRM_COMPLETE" },
      { phase: "deploy_verify", signal: "DEPLOY_VERIFY_FAILED" },
      { phase: "deploy_human_gate", signal: "DEPLOY_FIX_FORWARD" },
      { phase: "implement", signal: "IMPLEMENT_COMPLETE" },
      { phase: "codeReview", signal: "CODE_REVIEW_PASS" },
      { phase: "run_tests", signal: "RUN_TESTS_COMPLETE" },
      { phase: "blindqa", signal: "BLINDQA_COMPLETE" },
      { phase: "pre_deploy_confirm", signal: "PRE_DEPLOY_CONFIRM_COMPLETE" },
      { phase: "deploy_verify", signal: "DEPLOY_VERIFY_COMPLETE" },
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

  test("39. all to: targets reference phases that exist", () => {
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

  test("40. every non-terminal phase has a command", () => {
    for (const [name, phase] of Object.entries(pipelineA.phases) as [string, any][]) {
      if (phase.terminal) continue;
      expect(phase.command, `Phase '${name}' missing command`).toBeTruthy();
    }
  });
});

// ── Cross-variant comparison ────────────────────────────────────────────────

describe("e2e/deploy-variant: cross-variant comparison", () => {
  test("41. deploy has pre_deploy_confirm but backend does not", () => {
    const backendPipeline = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/TEST-M01/pipeline.json"), "utf-8")
    );

    expect(pipelineA.phases.pre_deploy_confirm).toBeDefined();
    expect(backendPipeline.phases.pre_deploy_confirm).toBeUndefined();
  });

  test("42. deploy has deploy_verify but backend does not", () => {
    const backendPipeline = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/TEST-M01/pipeline.json"), "utf-8")
    );

    expect(pipelineA.phases.deploy_verify).toBeDefined();
    expect(backendPipeline.phases.deploy_verify).toBeUndefined();
  });

  test("43. deploy has deploy_human_gate but backend does not", () => {
    const backendPipeline = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/TEST-M01/pipeline.json"), "utf-8")
    );

    expect(pipelineA.phases.deploy_human_gate).toBeDefined();
    expect(backendPipeline.phases.deploy_human_gate).toBeUndefined();
  });

  test("44. deploy blindqa routes to pre_deploy_confirm, backend blindqa routes to done", () => {
    const backendPipeline = JSON.parse(
      readFileSync(join(import.meta.dir, "fixtures/TEST-M01/pipeline.json"), "utf-8")
    );

    const deployBlindqa = resolveTransition("blindqa", "BLINDQA_COMPLETE", pipelineA);
    const backendBlindqa = resolveTransition("blindqa", "BLINDQA_COMPLETE", backendPipeline);

    expect(deployBlindqa!.to).toBe("pre_deploy_confirm");
    expect(backendBlindqa!.to).toBe("done");
  });
});
