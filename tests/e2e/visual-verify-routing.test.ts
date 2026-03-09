/**
 * tests/e2e/visual-verify-routing.test.ts
 *
 * E2E tests for the visual_verify phase routing using the compiled collab.pipeline.
 *
 * Verifies:
 *   - visual_verify phase exists with correct signals and command
 *   - VISUAL_VERIFY_COMPLETE routes to blindqa
 *   - VISUAL_VERIFY_FAILED and VISUAL_VERIFY_ERROR self-loop to visual_verify
 *   - run_tests → visual_verify routing works
 *   - TEST-H01 fixture has correct structure for integration testing
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  resolveTransition,
} from "../../minds/pipeline_core/transitions";
import { resolvePhaseCommand } from "../../minds/execution/phase-dispatch";
import { compileCollab } from "./helpers";

// ── Compile once ──────────────────────────────────────────────────────────────

const compiled = compileCollab();

// ── TEST-H01 fixture validation ──────────────────────────────────────────────

describe("e2e/TEST-H01: fixture structure", () => {
  const FIXTURE_DIR = join(import.meta.dir, "fixtures/TEST-H01");

  test("1. fixture pipeline.json has 3 phases (clarify, visual_verify, done)", () => {
    const pipeline = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "pipeline.json"), "utf-8")
    );
    const phaseIds = Object.keys(pipeline.phases);

    expect(phaseIds).toEqual(["clarify", "visual_verify", "done"]);
  });

  test("2. fixture stub-signals.json has triggers for both phases", () => {
    const stubs = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "stub-signals.json"), "utf-8")
    );

    expect(stubs.length).toBe(2);
    expect(stubs[0].trigger).toBe("/collab.clarify");
    expect(stubs[0].signal).toBe("CLARIFY_COMPLETE");
    expect(stubs[1].trigger).toBe("/collab.visual-verify");
    expect(stubs[1].signal).toBe("VISUAL_VERIFY_COMPLETE");
  });

  test("3. fixture expected.json matches clarify → visual_verify → done", () => {
    const expected = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "expected.json"), "utf-8")
    );

    expect(expected).toEqual(["clarify", "visual_verify", "done"]);
  });
});

// ── visual_verify phase in compiled pipeline ─────────────────────────────────

describe("e2e/visual-verify-routing: phase definition", () => {
  test("4. visual_verify phase exists in compiled pipeline", () => {
    expect(compiled.phases["visual_verify"]).toBeDefined();
  });

  test("5. visual_verify phase has /collab.visual-verify command", () => {
    const result = resolvePhaseCommand(compiled, "visual_verify");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("command");
    expect(result!.value).toBe("/collab.visual-verify");
  });

  test("6. visual_verify phase has exactly 3 signals", () => {
    const signals = compiled.phases["visual_verify"].signals;
    expect(signals).toContain("VISUAL_VERIFY_COMPLETE");
    expect(signals).toContain("VISUAL_VERIFY_FAILED");
    expect(signals).toContain("VISUAL_VERIFY_ERROR");
    expect(signals!.length).toBe(3);
  });
});

// ── visual_verify transition routing ─────────────────────────────────────────

describe("e2e/visual-verify-routing: transitions", () => {
  test("7. VISUAL_VERIFY_COMPLETE → advance to blindqa", () => {
    const t = resolveTransition("visual_verify", "VISUAL_VERIFY_COMPLETE", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("blindqa");
    expect(t!.gate).toBeNull();
  });

  test("8. VISUAL_VERIFY_FAILED → self-loop to visual_verify", () => {
    const t = resolveTransition("visual_verify", "VISUAL_VERIFY_FAILED", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("visual_verify");
  });

  test("9. VISUAL_VERIFY_ERROR → self-loop to visual_verify", () => {
    const t = resolveTransition("visual_verify", "VISUAL_VERIFY_ERROR", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("visual_verify");
  });
});

// ── run_tests → visual_verify routing ────────────────────────────────────────

describe("e2e/visual-verify-routing: run_tests flows to visual_verify", () => {
  test("10. run_tests + RUN_TESTS_COMPLETE → visual_verify", () => {
    const t = resolveTransition("run_tests", "RUN_TESTS_COMPLETE", compiled);
    expect(t).not.toBeNull();
    expect(t!.to).toBe("visual_verify");
  });
});
