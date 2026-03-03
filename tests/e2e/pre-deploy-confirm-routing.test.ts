/**
 * tests/e2e/pre-deploy-confirm-routing.test.ts
 *
 * E2E tests for the pre_deploy_confirm phase routing (BRE-364).
 *
 * Verifies:
 *   - TEST-J01 fixture has correct structure (4-phase deploy gate pipeline)
 *   - Happy path: tasks → pre_deploy_confirm → implement → done
 *   - Failure self-loop: PRE_DEPLOY_CONFIRM_FAILED → pre_deploy_confirm
 *   - Error escalation: PRE_DEPLOY_CONFIRM_ERROR → escalate
 *   - Full pipeline walk
 *   - Command is /collab.pre-deploy-confirm
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveTransition } from "../../src/lib/pipeline/transitions";

// ── Fixture paths ────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(import.meta.dir, "fixtures/TEST-J01");

// ── Load once ────────────────────────────────────────────────────────────────

const pipeline = JSON.parse(readFileSync(join(FIXTURE_DIR, "pipeline.json"), "utf-8"));
const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected.json"), "utf-8"));
const stubs = JSON.parse(readFileSync(join(FIXTURE_DIR, "stub-signals.json"), "utf-8"));

// ── TEST-J01 fixture validation ──────────────────────────────────────────────

describe("e2e/TEST-J01: fixture structure", () => {
  test("1. pipeline.json has 5 phases (3 active + 2 terminal)", () => {
    const phaseIds = Object.keys(pipeline.phases);
    expect(phaseIds.length).toBe(5);
  });

  test("2. expected.json has 4-phase happy path", () => {
    expect(expected.length).toBe(4);
    expect(expected[0]).toBe("tasks");
    expect(expected[1]).toBe("pre_deploy_confirm");
    expect(expected[2]).toBe("implement");
    expect(expected[expected.length - 1]).toBe("done");
  });

  test("3. stub-signals.json has 3 triggers", () => {
    expect(stubs.length).toBe(3);
  });

  test("4. version is 3.1", () => {
    expect(pipeline.version).toBe("3.1");
  });

  test("5. done and escalate are both terminal", () => {
    expect(pipeline.phases.done.terminal).toBe(true);
    expect(pipeline.phases.escalate.terminal).toBe(true);
  });

  test("6. pre_deploy_confirm phase has /collab.pre-deploy-confirm command", () => {
    expect(pipeline.phases.pre_deploy_confirm.command).toBe("/collab.pre-deploy-confirm");
  });
});

// ── Happy path transitions ───────────────────────────────────────────────────

describe("e2e/pre-deploy-confirm: happy path transitions", () => {
  test("7. tasks → pre_deploy_confirm on TASKS_COMPLETE", () => {
    const t = resolveTransition("tasks", "TASKS_COMPLETE", pipeline);
    expect(t!.to).toBe("pre_deploy_confirm");
  });

  test("8. pre_deploy_confirm → implement on PRE_DEPLOY_CONFIRM_COMPLETE", () => {
    const t = resolveTransition("pre_deploy_confirm", "PRE_DEPLOY_CONFIRM_COMPLETE", pipeline);
    expect(t!.to).toBe("implement");
  });

  test("9. implement → done on IMPLEMENT_COMPLETE", () => {
    const t = resolveTransition("implement", "IMPLEMENT_COMPLETE", pipeline);
    expect(t!.to).toBe("done");
  });
});

// ── Error/failure routing ────────────────────────────────────────────────────

describe("e2e/pre-deploy-confirm: error and failure routing", () => {
  test("10. PRE_DEPLOY_CONFIRM_FAILED → pre_deploy_confirm (self-loop)", () => {
    const t = resolveTransition("pre_deploy_confirm", "PRE_DEPLOY_CONFIRM_FAILED", pipeline);
    expect(t!.to).toBe("pre_deploy_confirm");
  });

  test("11. PRE_DEPLOY_CONFIRM_ERROR → escalate (no auto-retry)", () => {
    const t = resolveTransition("pre_deploy_confirm", "PRE_DEPLOY_CONFIRM_ERROR", pipeline);
    expect(t!.to).toBe("escalate");
  });

  test("12. IMPLEMENT_ERROR → implement (self-loop)", () => {
    const t = resolveTransition("implement", "IMPLEMENT_ERROR", pipeline);
    expect(t!.to).toBe("implement");
  });
});

// ── Full pipeline walk ───────────────────────────────────────────────────────

describe("e2e/pre-deploy-confirm: full pipeline walk", () => {
  test("13. walk happy path: 4 phases from tasks to done", () => {
    const visited: string[] = [];
    let current = Object.keys(pipeline.phases)[0];

    const happySignals: Record<string, string> = {
      tasks: "TASKS_COMPLETE",
      pre_deploy_confirm: "PRE_DEPLOY_CONFIRM_COMPLETE",
      implement: "IMPLEMENT_COMPLETE",
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

  test("14. all to: targets reference phases that exist", () => {
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

  test("15. every non-terminal phase has a command", () => {
    for (const [name, phase] of Object.entries(pipeline.phases) as [string, any][]) {
      if (phase.terminal) continue;
      expect(phase.command, `Phase '${name}' missing command`).toBeTruthy();
    }
  });

  test("16. pre_deploy_confirm has all three signal types declared", () => {
    const signals = pipeline.phases.pre_deploy_confirm.signals;
    expect(signals).toContain("PRE_DEPLOY_CONFIRM_COMPLETE");
    expect(signals).toContain("PRE_DEPLOY_CONFIRM_FAILED");
    expect(signals).toContain("PRE_DEPLOY_CONFIRM_ERROR");
    expect(signals.length).toBe(3);
  });
});
