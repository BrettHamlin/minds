/**
 * tests/unit/pipeline-config-read-interactive-default.test.ts
 *
 * Guard test: ensures pipeline-config-read.ts defaults interactive.enabled
 * to FALSE when the interactive field is absent from pipeline.json.
 *
 * Background: When pipeline.json has no `interactive` field, orchestrated
 * pipelines should use the non-interactive batch protocol (step 8a in clarify).
 * A previous bug used `ia.enabled !== false` which defaults to true when
 * the field is absent (undefined !== false === true). The correct check is
 * `ia.enabled === true` so absence defaults to false.
 *
 * This test imports the source file directly and validates the logic by
 * reading the actual TypeScript source to ensure the pattern stays correct.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const CONFIG_READ_PATH = resolve(
  PROJECT_ROOT,
  "minds/execution/pipeline-config-read.ts"
);

describe("pipeline-config-read interactive default", () => {
  test("interactive.enabled defaults to false when field is absent (uses === true, NOT !== false)", () => {
    const source = readFileSync(CONFIG_READ_PATH, "utf-8");

    // The correct pattern: ia.enabled === true ? "true" : "false"
    // This means: only true when EXPLICITLY set to true. Absence → false.
    expect(source).toContain('ia.enabled === true ? "true" : "false"');

    // The INCORRECT pattern that caused the bug: ia.enabled !== false
    // This means: true when absent (undefined !== false === true). WRONG.
    expect(source).not.toContain('ia.enabled !== false ? "true" : "false"');
  });

  test("codeReview.enabled still defaults to true (different intent)", () => {
    const source = readFileSync(CONFIG_READ_PATH, "utf-8");

    // codeReview defaults to enabled (opt-out), so !== false is correct there
    expect(source).toContain('cr.enabled !== false ? "true" : "false"');
  });
});
