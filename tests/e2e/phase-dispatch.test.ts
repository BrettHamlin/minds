/**
 * tests/e2e/phase-dispatch.test.ts
 *
 * Category 2: Phase Dispatch — verifies phase-dispatch.ts can resolve commands
 * from the compiled collab.pipeline output.
 *
 * Tests that the command/actions resolver works correctly end-to-end:
 * simple command phases, actions block phases, terminal no-op, unknown phase.
 */

import { describe, test, expect } from "bun:test";
import { resolvePhaseCommand } from "../../minds/execution/phase-dispatch";
import { compileCollab } from "./helpers";

// ── Compile once ──────────────────────────────────────────────────────────────

const compiled = compileCollab();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("e2e/phase-dispatch: resolvePhaseCommand(compiled, ...)", () => {
  test("1. clarify phase → {type: 'command', value: '/collab.clarify'}", () => {
    const result = resolvePhaseCommand(compiled, "clarify");
    expect(result).toMatchObject({ type: "command", value: "/collab.clarify" });
  });

  test("2. plan phase → {type: 'command', value: '/collab.plan'}", () => {
    const result = resolvePhaseCommand(compiled, "plan");
    expect(result).toMatchObject({ type: "command", value: "/collab.plan" });
  });

  test("3. tasks phase → {type: 'command', value: '/collab.tasks'}", () => {
    const result = resolvePhaseCommand(compiled, "tasks");
    expect(result).toMatchObject({ type: "command", value: "/collab.tasks" });
  });

  test("4. analyze phase → {type: 'command', value: '/collab.analyze'}", () => {
    const result = resolvePhaseCommand(compiled, "analyze");
    expect(result).toMatchObject({ type: "command", value: "/collab.analyze" });
  });

  test("5. implement phase → {type: 'actions', value: array}", () => {
    const result = resolvePhaseCommand(compiled, "implement");
    expect(result?.type).toBe("actions");
    if (result?.type === "actions") {
      expect(result.value.length).toBeGreaterThan(0);
    }
  });

  test("6. implement actions include a command entry for /collab.implement", () => {
    const result = resolvePhaseCommand(compiled, "implement");
    if (result?.type !== "actions") throw new Error("Expected type: actions");
    const commandAction = result.value.find(
      (a): a is { command: string } => "command" in a
    );
    expect(commandAction?.command).toBe("/collab.implement");
  });

  test("7. implement actions include a display entry", () => {
    const result = resolvePhaseCommand(compiled, "implement");
    if (result?.type !== "actions") throw new Error("Expected type: actions");
    const displayAction = result.value.find((a) => "display" in a);
    expect(displayAction).toBeDefined();
  });

  test("8. blindqa phase → {type: 'actions', value: array with /collab.blindqa}", () => {
    const result = resolvePhaseCommand(compiled, "blindqa");
    expect(result?.type).toBe("actions");
    if (result?.type === "actions") {
      const commandAction = result.value.find(
        (a): a is { command: string } => "command" in a
      );
      expect(commandAction?.command).toBe("/collab.blindqa");
    }
  });

  test("9. done (terminal) → null (no dispatch)", () => {
    const result = resolvePhaseCommand(compiled, "done");
    expect(result).toBeNull();
  });

  test("10. unknown phase throws VALIDATION error", () => {
    expect(() => resolvePhaseCommand(compiled, "nonexistent-phase")).toThrow(
      "not found in pipeline.json"
    );
  });
});
