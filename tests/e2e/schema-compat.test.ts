/**
 * tests/e2e/schema-compat.test.ts
 *
 * Category 1: Schema Compatibility — compiled pipeline has all fields every
 *             orchestrator command expects.
 * Category 7: Schema Drift Guard — catches format changes (array vs object,
 *             missing fields, wrong version) that break the orchestrator.
 *
 * Uses the real collab.pipeline as input, not hand-written JSON.
 */

import { describe, test, expect } from "bun:test";
import { compileCollab } from "./helpers";

// ── Compile once ──────────────────────────────────────────────────────────────

const compiled = compileCollab();

// ── Category 1: Schema Compatibility ─────────────────────────────────────────

describe("e2e/schema-compat: compiled pipeline structure (category 1)", () => {
  test("1. parses and compiles collab.pipeline without errors", () => {
    // compileCollab() throws on any parse error; reaching here means success.
    expect(compiled).not.toBeNull();
    expect(typeof compiled.version).toBe("string");
  });

  test("2. every non-terminal phase has command or actions", () => {
    for (const [name, phase] of Object.entries(compiled.phases)) {
      if (phase.terminal) continue;
      const hasDispatchable = !!(
        phase.command ||
        (phase.actions && phase.actions.length > 0)
      );
      expect(hasDispatchable, `Phase '${name}' missing command or actions`).toBe(true);
    }
  });

  test("3. every non-terminal phase has at least one signal", () => {
    for (const [name, phase] of Object.entries(compiled.phases)) {
      if (phase.terminal) continue;
      expect(
        phase.signals?.length ?? 0,
        `Phase '${name}' has no signals`
      ).toBeGreaterThan(0);
    }
  });

  test("4. every non-terminal phase has at least one transition or conditionalTransition", () => {
    for (const [name, phase] of Object.entries(compiled.phases)) {
      if (phase.terminal) continue;
      const directCount = Object.keys(phase.transitions ?? {}).length;
      const conditionalCount = phase.conditionalTransitions?.length ?? 0;
      expect(
        directCount + conditionalCount,
        `Phase '${name}' has no transitions`
      ).toBeGreaterThan(0);
    }
  });

  test("5. compiled gates have a non-empty prompt", () => {
    for (const [name, gate] of Object.entries(compiled.gates ?? {})) {
      expect(gate.prompt, `Gate '${name}' missing prompt`).toBeTruthy();
    }
  });

  test("6. every gate has at least one response keyword", () => {
    for (const [name, gate] of Object.entries(compiled.gates ?? {})) {
      expect(
        Object.keys(gate.on).length,
        `Gate '${name}' has no on-handlers`
      ).toBeGreaterThan(0);
    }
  });

  test("7. every gate response has to: or onExhaust:", () => {
    for (const [gateName, gate] of Object.entries(compiled.gates ?? {})) {
      for (const [keyword, response] of Object.entries(gate.on)) {
        const hasRouting = response.to !== undefined || response.onExhaust !== undefined;
        expect(
          hasRouting,
          `Gate '${gateName}' keyword '${keyword}' missing to: or onExhaust:`
        ).toBe(true);
      }
    }
  });
});

// ── Category 7: Schema Drift Guard ───────────────────────────────────────────

describe("e2e/schema-compat: schema drift guard (category 7)", () => {
  test("8. version is 3.1 or higher", () => {
    expect(parseFloat(compiled.version)).toBeGreaterThanOrEqual(3.1);
  });

  test("9. phases is an object (not an array)", () => {
    expect(Array.isArray(compiled.phases)).toBe(false);
    expect(typeof compiled.phases).toBe("object");
  });

  test("10. gates is an object (not an array) when present", () => {
    if (compiled.gates) {
      expect(Array.isArray(compiled.gates)).toBe(false);
      expect(typeof compiled.gates).toBe("object");
    }
  });

  test("11. every direct transition has exactly one of to: or gate:", () => {
    for (const [phaseName, phase] of Object.entries(compiled.phases)) {
      for (const [signal, t] of Object.entries(phase.transitions ?? {})) {
        const hasTo = "to" in t;
        const hasGate = "gate" in t;
        expect(
          hasTo || hasGate,
          `Phase '${phaseName}' signal '${signal}' transition has neither to: nor gate:`
        ).toBe(true);
        expect(
          hasTo && hasGate,
          `Phase '${phaseName}' signal '${signal}' transition has both to: and gate:`
        ).toBe(false);
      }
    }
  });

  test("12. collab.pipeline compiles to the 9 expected phases in order", () => {
    const phaseNames = Object.keys(compiled.phases);
    expect(phaseNames).toEqual([
      "clarify",
      "plan",
      "tasks",
      "analyze",
      "implement",
      "run_tests",
      "visual_verify",
      "blindqa",
      "done",
    ]);
  });

  test("13. done is the only terminal phase", () => {
    const terminalPhases = Object.entries(compiled.phases)
      .filter(([, p]) => p.terminal)
      .map(([name]) => name);
    expect(terminalPhases).toEqual(["done"]);
  });

  test("14. adding a phase without transitions breaks this test (sentinel)", () => {
    // Every non-terminal phase must route somewhere — no dead ends
    for (const [name, phase] of Object.entries(compiled.phases)) {
      if (phase.terminal) continue;
      const allSignals = phase.signals ?? [];
      const routedSignals = new Set([
        ...Object.keys(phase.transitions ?? {}),
        ...(phase.conditionalTransitions ?? []).map((r) => r.signal),
      ]);
      // Every signal must have at least one transition (direct or conditional)
      for (const signal of allSignals) {
        // _WAITING/_QUESTION signals are lifecycle notifications, not routable
        if (signal.endsWith("_WAITING") || signal.endsWith("_QUESTION")) continue;
        expect(
          routedSignals.has(signal),
          `Phase '${name}' signal '${signal}' has no transition`
        ).toBe(true);
      }
    }
  });
});
