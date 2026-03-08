import { describe, test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  SIGNAL_SUFFIXES,
  isSuccessSignal,
  CLARIFY_COMPLETE,
  CLARIFY_QUESTION,
  CLARIFY_ERROR,
  CLARIFY_QUESTIONS,
} from "./pipeline-signal";

const CONFIG_DIR = path.join(__dirname, "../../minds/templates/pipeline-variants");

describe("signal-contract: pipeline config validation", () => {
  const configFiles = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".json"));

  for (const configFile of configFiles) {
    describe(configFile, () => {
      const config = JSON.parse(
        fs.readFileSync(path.join(CONFIG_DIR, configFile), "utf-8")
      );

      for (const [phaseName, phaseConfig] of Object.entries(config.phases)) {
        if ((phaseConfig as any).terminal) continue;
        if ((phaseConfig as any).human_gate) continue;
        const phase = phaseConfig as any;

        test(`${phaseName}: has at least one success signal`, () => {
          const successSignals = (phase.signals || []).filter(isSuccessSignal);
          expect(successSignals.length).toBeGreaterThan(0);
        });

        test(`${phaseName}: all transition signals are in signals list`, () => {
          const transitions = Object.keys(phase.transitions || {});
          const signals = phase.signals || [];
          for (const sig of transitions) {
            expect(signals).toContain(sig);
          }
        });

        test(`${phaseName}: signal names match phase prefix`, () => {
          const prefix = phaseName.toUpperCase();
          for (const sig of phase.signals || []) {
            expect(sig.startsWith(prefix + "_")).toBe(true);
          }
        });

        test(`${phaseName}: success transition leads to valid phase`, () => {
          for (const [signal, transition] of Object.entries(phase.transitions || {})) {
            if (isSuccessSignal(signal)) {
              const target = (transition as any).to;
              if (target) {
                expect(Object.keys(config.phases)).toContain(target);
              }
            }
          }
        });
      }
    });
  }
});

describe("clarify signal constants", () => {
  test("CLARIFY_COMPLETE is the string 'CLARIFY_COMPLETE'", () => {
    expect(CLARIFY_COMPLETE).toBe("CLARIFY_COMPLETE");
  });

  test("CLARIFY_QUESTION is the string 'CLARIFY_QUESTION'", () => {
    expect(CLARIFY_QUESTION).toBe("CLARIFY_QUESTION");
  });

  test("CLARIFY_ERROR is the string 'CLARIFY_ERROR'", () => {
    expect(CLARIFY_ERROR).toBe("CLARIFY_ERROR");
  });

  test("CLARIFY_QUESTIONS is the string 'CLARIFY_QUESTIONS'", () => {
    expect(CLARIFY_QUESTIONS).toBe("CLARIFY_QUESTIONS");
  });

  test("CLARIFY_COMPLETE is a success signal", () => {
    expect(isSuccessSignal(CLARIFY_COMPLETE)).toBe(true);
  });

  test("CLARIFY_QUESTION is not a success signal (it is informational)", () => {
    expect(isSuccessSignal(CLARIFY_QUESTION)).toBe(false);
  });

  test("CLARIFY_ERROR is not a success signal", () => {
    expect(isSuccessSignal(CLARIFY_ERROR)).toBe(false);
  });

  test("CLARIFY_QUESTIONS is not a success signal (it is informational)", () => {
    expect(isSuccessSignal(CLARIFY_QUESTIONS)).toBe(false);
  });
});
