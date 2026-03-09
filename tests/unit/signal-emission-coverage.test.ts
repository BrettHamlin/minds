import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const HANDLERS_DIR = join(__dirname, "../../minds/signals");
const VARIANTS_DIR = join(__dirname, "../../minds/templates/pipeline-variants");

// mirrors mapResponseState in pipeline-signal.ts
const stateMap: Record<string, string> = {
  completed: "COMPLETE",
  awaitingInput: "QUESTION",
  waiting: "WAITING",
  failed: "FAILED",
  error: "ERROR",
};

type EmittedSignal = { handler: string; phase: string; event: string; signal: string };
type Gap = { signal: string; handler: string; variant: string; phase: string };

function collectEmittedSignals(): EmittedSignal[] {
  const results: EmittedSignal[] = [];

  const handlerFiles = readdirSync(HANDLERS_DIR).filter(
    (f) =>
      f.startsWith("emit-") &&
      f.endsWith("-signal.ts") &&
      f !== "emit-phase-signal.ts" &&
      f !== "emit-question-signal.ts" &&
      !f.endsWith(".test.ts")
  );

  for (const file of handlerFiles) {
    const content = readFileSync(join(HANDLERS_DIR, file), "utf-8");

    // Extract: emitPhaseSignal("phase_name", { key: "state", ... });
    const match = content.match(/emitPhaseSignal\(\s*["']([^"']+)["']\s*,\s*\{([^}]+)\}/s);
    if (!match) continue;

    const phase = match[1];
    const body = match[2];

    // Parse each key: "stateString" pair
    const pairRe = /(\w+)\s*:\s*["']([^"']+)["']/g;
    let pair: RegExpExecArray | null;
    while ((pair = pairRe.exec(body)) !== null) {
      const event = pair[1];
      const stateString = pair[2];
      const suffix = stateMap[stateString];
      if (!suffix) continue; // unknown state string — skip
      const signal = `${phase.toUpperCase()}_${suffix}`;
      results.push({ handler: file, phase, event, signal });
    }
  }

  return results;
}

function collectGaps(emitted: EmittedSignal[]): Gap[] {
  const gaps: Gap[] = [];

  const variantFiles = readdirSync(VARIANTS_DIR).filter((f) => f.endsWith(".json"));

  for (const variantFile of variantFiles) {
    const config = JSON.parse(readFileSync(join(VARIANTS_DIR, variantFile), "utf-8"));
    const phases: Record<string, { signals?: string[] }> = config.phases ?? {};

    for (const { handler, phase, signal } of emitted) {
      if (!(phase in phases)) continue; // this variant doesn't have this phase — skip
      const allowed: string[] = phases[phase]?.signals ?? [];
      if (!allowed.includes(signal)) {
        gaps.push({ signal, handler, variant: variantFile, phase });
      }
    }
  }

  return gaps;
}

describe("signal emission coverage", () => {
  test("all emitted signals are allowed in pipeline variant configs", () => {
    const emitted = collectEmittedSignals();
    expect(emitted.length).toBeGreaterThan(0); // sanity check

    const gaps = collectGaps(emitted);
    if (gaps.length > 0) {
      const report = gaps
        .map(
          (g) =>
            `${g.variant}: phase "${g.phase}" missing signal "${g.signal}" (emitted by ${g.handler})`
        )
        .join("\n");
      console.error("Signal coverage gaps:\n" + report);
      expect(gaps).toEqual([]);
    }
  });

  test("handler files found", () => {
    const handlers = readdirSync(HANDLERS_DIR)
      .filter(
        (f) =>
          f.startsWith("emit-") &&
          f.endsWith("-signal.ts") &&
          f !== "emit-phase-signal.ts" &&
          f !== "emit-question-signal.ts" &&
          !f.endsWith(".test.ts")
      );
    expect(handlers.length).toBeGreaterThan(0);
  });
});
