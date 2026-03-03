/**
 * tests/e2e/run-tests-routing.test.ts
 *
 * E2E tests for the run_tests phase routing using the compiled collab.pipeline.
 *
 * Verifies:
 *   - run_tests phase exists with correct signals and command
 *   - RUN_TESTS_COMPLETE routes to blindqa
 *   - RUN_TESTS_FAILED and RUN_TESTS_ERROR self-loop to run_tests
 *   - TEST-G01 fixture has correct structure for integration testing
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  resolveTransition,
  resolveConditionalTransition,
} from "../../src/lib/pipeline/transitions";
import { resolvePhaseCommand } from "../../src/scripts/orchestrator/commands/phase-dispatch";
import { compileCollab } from "./helpers";

// ── Compile once ──────────────────────────────────────────────────────────────

const compiled = compileCollab();

// ── TEST-G01 fixture validation ──────────────────────────────────────────────

describe("e2e/TEST-G01: fixture structure", () => {
  const FIXTURE_DIR = join(import.meta.dir, "fixtures/TEST-G01");

  test("1. fixture pipeline.json has 3 phases (clarify, run_tests, done)", () => {
    const pipeline = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline.json"), "utf-8")
    );
    const phaseIds = Object.keys(pipeline.phases);

    expect(phaseIds).toEqual(["clarify", "run_tests", "done"]);
  });

  test("2. fixture stub-signals.json has triggers for both phases", () => {
    const stubs = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "stub-signals.json"), "utf-8")
    );

    expect(stubs.length).toBe(2);
    expect(stubs[0].trigger).toBe("/collab.clarify");
    expect(stubs[0].signal).toBe("CLARIFY_COMPLETE");
    expect(stubs[1].trigger).toBe("/collab.run-tests");
    expect(stubs[1].signal).toBe("RUN_TESTS_COMPLETE");
  });

  test("3. fixture expected.json matches clarify → run_tests → done", () => {
    const expected = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "expected.json"), "utf-8")
    );

    expect(expected).toEqual(["clarify", "run_tests", "done"]);
  });

  test("4. fixture run-tests.json has valid config", () => {
    const config = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "run-tests.json"), "utf-8")
    );

    expect(config.command).toBeDefined();
    expect(typeof config.command).toBe("string");
    expect(config.timeout).toBeDefined();
  });
});

// ── run_tests phase in compiled pipeline ─────────────────────────────────────

describe("e2e/run-tests-routing: phase definition", () => {
  test("5. run_tests phase exists in compiled pipeline", () => {
    expect(compiled.phases["run_tests"]).toBeDefined();
  });

  test("6. run_tests phase has /collab.run-tests command", () => {
    const result = resolvePhaseCommand(compiled, "run_tests");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("command");
    expect(result!.value).toBe("/collab.run-tests");
  });

  test("7. run_tests phase has exactly 3 signals", () => {
    const signals = compiled.phases["run_tests"].signals;
    expect(signals).toContain("RUN_TESTS_COMPLETE");
    expect(signals).toContain("RUN_TESTS_FAILED");
    expect(signals).toContain("RUN_TESTS_ERROR");
    expect(signals!.length).toBe(3);
  });
});

// ── run_tests transition routing ─────────────────────────────────────────────

describe("e2e/run-tests-routing: transitions", () => {
  test("8. RUN_TESTS_COMPLETE → advance to blindqa", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_COMPLETE", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("blindqa");
    expect(t!.gate).toBeNull();
  });

  test("9. RUN_TESTS_FAILED → self-loop to run_tests", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_FAILED", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("run_tests");
  });

  test("10. RUN_TESTS_ERROR → self-loop to run_tests", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_ERROR", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("run_tests");
  });
});

// ── implement → run_tests routing ────────────────────────────────────────────

describe("e2e/run-tests-routing: implement flows to run_tests", () => {
  test("11. implement + IMPLEMENT_COMPLETE (otherwise) → run_tests", () => {
    const rows = compiled.phases["implement"].conditionalTransitions ?? [];
    const t = resolveConditionalTransition(rows, "IMPLEMENT_COMPLETE");
    expect(t).not.toBeNull();
    expect(t!.to).toBe("run_tests");
  });
});

