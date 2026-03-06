import { describe, test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { SIGNAL_SUFFIXES, isSuccessSignal } from "./pipeline-signal";

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
