/**
 * tests/e2e/deploy-verify-routing.test.ts
 *
 * E2E tests for the deploy_verify phase routing (BRE-365).
 *
 * Verifies:
 *   - TEST-K01 fixture has correct structure (3-phase deploy verify pipeline)
 *   - Happy path: clarify → deploy_verify → done
 *   - Failure self-loop: DEPLOY_VERIFY_FAILED → deploy_verify
 *   - Error escalation: DEPLOY_VERIFY_ERROR → escalate
 *   - Full pipeline walk
 *   - Command is /collab.deploy-verify
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveTransition } from "../../src/lib/pipeline/transitions";

// ── Fixture paths ────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(import.meta.dir, "fixtures/TEST-K01");

// ── Load once ────────────────────────────────────────────────────────────────

const pipeline = JSON.parse(readFileSync(join(FIXTURE_DIR, "pipeline.json"), "utf-8"));
const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected.json"), "utf-8"));
const stubs = JSON.parse(readFileSync(join(FIXTURE_DIR, "stub-signals.json"), "utf-8"));

// ── TEST-K01 fixture validation ──────────────────────────────────────────────

describe("e2e/TEST-K01: fixture structure", () => {
  test("1. pipeline.json has 4 phases (2 active + 2 terminal)", () => {
    const phaseIds = Object.keys(pipeline.phases);
    expect(phaseIds.length).toBe(4);
  });

  test("2. expected.json has 3-phase happy path", () => {
    expect(expected.length).toBe(3);
    expect(expected[0]).toBe("clarify");
    expect(expected[1]).toBe("deploy_verify");
    expect(expected[expected.length - 1]).toBe("done");
  });

  test("3. stub-signals.json has 2 triggers", () => {
    expect(stubs.length).toBe(2);
  });

  test("4. version is 3.1", () => {
    expect(pipeline.version).toBe("3.1");
  });

  test("5. done and escalate are both terminal", () => {
    expect(pipeline.phases.done.terminal).toBe(true);
    expect(pipeline.phases.escalate.terminal).toBe(true);
  });

  test("6. deploy_verify phase has /collab.deploy-verify command", () => {
    expect(pipeline.phases.deploy_verify.command).toBe("/collab.deploy-verify");
  });
});

// ── Happy path transitions ───────────────────────────────────────────────────

describe("e2e/deploy-verify: happy path transitions", () => {
  test("7. clarify → deploy_verify on CLARIFY_COMPLETE", () => {
    const t = resolveTransition("clarify", "CLARIFY_COMPLETE", pipeline);
    expect(t!.to).toBe("deploy_verify");
  });

  test("8. deploy_verify → done on DEPLOY_VERIFY_COMPLETE", () => {
    const t = resolveTransition("deploy_verify", "DEPLOY_VERIFY_COMPLETE", pipeline);
    expect(t!.to).toBe("done");
  });
});

// ── Error/failure routing ────────────────────────────────────────────────────

describe("e2e/deploy-verify: error and failure routing", () => {
  test("9. DEPLOY_VERIFY_FAILED → deploy_verify (self-loop)", () => {
    const t = resolveTransition("deploy_verify", "DEPLOY_VERIFY_FAILED", pipeline);
    expect(t!.to).toBe("deploy_verify");
  });

  test("10. DEPLOY_VERIFY_ERROR → escalate (no auto-retry)", () => {
    const t = resolveTransition("deploy_verify", "DEPLOY_VERIFY_ERROR", pipeline);
    expect(t!.to).toBe("escalate");
  });
});

// ── Full pipeline walk ───────────────────────────────────────────────────────

describe("e2e/deploy-verify: full pipeline walk", () => {
  test("11. walk happy path: 3 phases from clarify to done", () => {
    const visited: string[] = [];
    let current = Object.keys(pipeline.phases)[0];

    const happySignals: Record<string, string> = {
      clarify: "CLARIFY_COMPLETE",
      deploy_verify: "DEPLOY_VERIFY_COMPLETE",
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

  test("12. all to: targets reference phases that exist", () => {
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

  test("13. every non-terminal phase has a command", () => {
    for (const [name, phase] of Object.entries(pipeline.phases) as [string, any][]) {
      if (phase.terminal) continue;
      expect(phase.command, `Phase '${name}' missing command`).toBeTruthy();
    }
  });

  test("14. deploy_verify has all three signal types declared", () => {
    const signals = pipeline.phases.deploy_verify.signals;
    expect(signals).toContain("DEPLOY_VERIFY_COMPLETE");
    expect(signals).toContain("DEPLOY_VERIFY_FAILED");
    expect(signals).toContain("DEPLOY_VERIFY_ERROR");
    expect(signals.length).toBe(3);
  });
});
