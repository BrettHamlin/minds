/**
 * Unit tests for clarify phase types in types.ts.
 */

import { describe, test, expect } from "bun:test";
import type { ClarifySignal, ClarifyPhaseConfig } from "./types";

describe("ClarifySignal", () => {
  test("all four clarify signals are assignable to ClarifySignal", () => {
    const signals: ClarifySignal[] = [
      "CLARIFY_COMPLETE",
      "CLARIFY_QUESTION",
      "CLARIFY_ERROR",
      "CLARIFY_QUESTIONS",
    ];
    expect(signals).toHaveLength(4);
    expect(signals).toContain("CLARIFY_COMPLETE");
    expect(signals).toContain("CLARIFY_QUESTION");
    expect(signals).toContain("CLARIFY_ERROR");
    expect(signals).toContain("CLARIFY_QUESTIONS");
  });
});

describe("ClarifyPhaseConfig", () => {
  test("accepts full clarify phase config", () => {
    const config: ClarifyPhaseConfig = {
      command: "/collab.clarify",
      signals: ["CLARIFY_COMPLETE", "CLARIFY_QUESTION", "CLARIFY_ERROR", "CLARIFY_QUESTIONS"],
      transitions: {
        CLARIFY_COMPLETE: { to: "plan" },
        CLARIFY_ERROR: { to: "clarify" },
      },
      model: "claude-opus-4-6",
      inputs: ["ticket_spec", "clarify_output"],
      outputs: ["clarify_output"],
    };
    expect(config.command).toBe("/collab.clarify");
    expect(config.signals).toHaveLength(4);
    expect(config.model).toBe("claude-opus-4-6");
  });

  test("accepts minimal clarify phase config", () => {
    const config: ClarifyPhaseConfig = {};
    expect(config.signals).toBeUndefined();
    expect(config.command).toBeUndefined();
  });

  test("signals field is narrowed to ClarifySignal[]", () => {
    const config: ClarifyPhaseConfig = {
      signals: ["CLARIFY_COMPLETE", "CLARIFY_QUESTIONS"],
    };
    expect(config.signals).toEqual(["CLARIFY_COMPLETE", "CLARIFY_QUESTIONS"]);
  });

  test("CLARIFY_COMPLETE transitions to plan in typical config", () => {
    const config: ClarifyPhaseConfig = {
      transitions: {
        CLARIFY_COMPLETE: { to: "plan" },
        CLARIFY_ERROR: { to: "clarify" },
      },
    };
    const transitions = config.transitions!;
    expect("to" in transitions.CLARIFY_COMPLETE).toBe(true);
    expect((transitions.CLARIFY_COMPLETE as { to: string }).to).toBe("plan");
    expect((transitions.CLARIFY_ERROR as { to: string }).to).toBe("clarify");
  });
});
