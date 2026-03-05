// Signal consistency lint: every variant config must be a superset of main pipeline.json signals
// for any phase that exists in both configs.
import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const CONFIG_DIR = join(import.meta.dir, "..");
const VARIANTS_DIR = join(CONFIG_DIR, "pipeline-variants");

// test.json has completely different phases (not a superset scenario) — skip it
const SKIP_VARIANTS = new Set(["test"]);

interface PipelineConfig {
  phases: Record<string, { signals?: string[] }>;
}

function loadJson(path: string): PipelineConfig {
  return JSON.parse(readFileSync(path, "utf-8")) as PipelineConfig;
}

const main = loadJson(join(CONFIG_DIR, "pipeline.json"));

const variantFiles = readdirSync(VARIANTS_DIR)
  .filter((f) => f.endsWith(".json") && !SKIP_VARIANTS.has(f.replace(".json", "")));

describe("signal-consistency: variant configs are supersets of main", () => {
  for (const file of variantFiles) {
    const variantName = file.replace(".json", "");
    const variant = loadJson(join(VARIANTS_DIR, file));

    const sharedPhases = Object.keys(main.phases).filter(
      (phase) => phase in variant.phases,
    );

    for (const phase of sharedPhases) {
      test(`${variantName}/${phase} has all signals from main`, () => {
        const mainSignals = new Set(main.phases[phase].signals ?? []);
        const variantSignals = new Set(variant.phases[phase].signals ?? []);
        const missing = [...mainSignals].filter((s) => !variantSignals.has(s));

        expect(
          missing,
          `${variantName}/${phase} is missing signals from main: ${missing.join(", ")}`,
        ).toHaveLength(0);
      });
    }
  }
});
