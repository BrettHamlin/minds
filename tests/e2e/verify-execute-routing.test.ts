/**
 * tests/e2e/verify-execute-routing.test.ts
 *
 * E2E tests for the verify_execute phase routing (BRE-356).
 *
 * Verifies:
 *   - TEST-I01 fixture has correct structure (3-phase verification pipeline)
 *   - Happy path: clarify → verify_execute → done
 *   - Failure self-loop: VERIFY_EXECUTE_FAILED → verify_execute
 *   - Error escalation: VERIFY_EXECUTE_ERROR → escalate
 *   - Full pipeline walk
 *   - Command is /collab.verify-execute
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveTransition } from "../../minds/pipeline_core/transitions";

// ── Fixture paths ────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(import.meta.dir, "fixtures/TEST-I01");

// ── Load once ────────────────────────────────────────────────────────────────

const pipeline = JSON.parse(readFileSync(join(FIXTURE_DIR, "pipeline.json"), "utf-8"));
const expected = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected.json"), "utf-8"));
const stubs = JSON.parse(readFileSync(join(FIXTURE_DIR, "stub-signals.json"), "utf-8"));

// ── TEST-I01 fixture validation ──────────────────────────────────────────────

describe("e2e/TEST-I01: fixture structure", () => {
  test("1. pipeline.json has 4 phases (2 active + 2 terminal)", () => {
    const phaseIds = Object.keys(pipeline.phases);
    expect(phaseIds.length).toBe(4);
  });

  test("2. expected.json has 3-phase happy path", () => {
    expect(expected.length).toBe(3);
    expect(expected[0]).toBe("clarify");
    expect(expected[1]).toBe("verify_execute");
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

  test("6. verify_execute phase has /collab.verify-execute command", () => {
    expect(pipeline.phases.verify_execute.command).toBe("/collab.verify-execute");
  });
});

// ── Happy path transitions ───────────────────────────────────────────────────

describe("e2e/verify-execute: happy path transitions", () => {
  test("7. clarify → verify_execute on CLARIFY_COMPLETE", () => {
    const t = resolveTransition("clarify", "CLARIFY_COMPLETE", pipeline);
    expect(t!.to).toBe("verify_execute");
  });

  test("8. verify_execute → done on VERIFY_EXECUTE_COMPLETE", () => {
    const t = resolveTransition("verify_execute", "VERIFY_EXECUTE_COMPLETE", pipeline);
    expect(t!.to).toBe("done");
  });
});

// ── Error/failure routing ────────────────────────────────────────────────────

describe("e2e/verify-execute: error and failure routing", () => {
  test("9. VERIFY_EXECUTE_FAILED → verify_execute (self-loop)", () => {
    const t = resolveTransition("verify_execute", "VERIFY_EXECUTE_FAILED", pipeline);
    expect(t!.to).toBe("verify_execute");
  });

  test("10. VERIFY_EXECUTE_ERROR → escalate (no auto-retry)", () => {
    const t = resolveTransition("verify_execute", "VERIFY_EXECUTE_ERROR", pipeline);
    expect(t!.to).toBe("escalate");
  });
});

// ── Full pipeline walk ───────────────────────────────────────────────────────

describe("e2e/verify-execute: full pipeline walk", () => {
  test("11. walk happy path: 3 phases from clarify to done", () => {
    const visited: string[] = [];
    let current = Object.keys(pipeline.phases)[0];

    const happySignals: Record<string, string> = {
      clarify: "CLARIFY_COMPLETE",
      verify_execute: "VERIFY_EXECUTE_COMPLETE",
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

  test("14. verify_execute has all three signal types declared", () => {
    const signals = pipeline.phases.verify_execute.signals;
    expect(signals).toContain("VERIFY_EXECUTE_COMPLETE");
    expect(signals).toContain("VERIFY_EXECUTE_FAILED");
    expect(signals).toContain("VERIFY_EXECUTE_ERROR");
    expect(signals.length).toBe(3);
  });
});
