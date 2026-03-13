/**
 * pipeline-templates.test.ts — Tests for pipeline templates and resolution logic.
 */

import { describe, test, expect } from "bun:test";
import {
  CODE_PIPELINE,
  BUILD_PIPELINE,
  TEST_PIPELINE,
  getTemplate,
  resolvePipeline,
  producesCode,
} from "../pipeline-templates.ts";
import type { MindDescription } from "../../../mind.ts";

// ---------------------------------------------------------------------------
// Helper: minimal valid MindDescription
// ---------------------------------------------------------------------------

function makeMind(overrides?: Partial<MindDescription>): MindDescription {
  return {
    name: "test-mind",
    domain: "testing",
    keywords: ["test"],
    owns_files: ["src/"],
    capabilities: ["test things"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Template structure tests
// ---------------------------------------------------------------------------

describe("CODE_PIPELINE", () => {
  test("has exactly 7 stages", () => {
    expect(CODE_PIPELINE).toHaveLength(7);
  });

  test("stages are in correct order", () => {
    const types = CODE_PIPELINE.map((s) => s.type);
    expect(types).toEqual([
      "spawn-drone",
      "wait-completion",
      "git-diff",
      "run-tests",
      "boundary-check",
      "contract-check",
      "llm-review",
    ]);
  });

  test("all stages have labels", () => {
    for (const stage of CODE_PIPELINE) {
      expect(stage.label).toBeDefined();
      expect(typeof stage.label).toBe("string");
    }
  });

  test("no stages have on_fail set (all default to reject)", () => {
    for (const stage of CODE_PIPELINE) {
      expect(stage.on_fail).toBeUndefined();
    }
  });
});

describe("BUILD_PIPELINE", () => {
  test("has exactly 4 stages", () => {
    expect(BUILD_PIPELINE).toHaveLength(4);
  });

  test("stages are in correct order", () => {
    const types = BUILD_PIPELINE.map((s) => s.type);
    expect(types).toEqual([
      "spawn-drone",
      "wait-completion",
      "run-command",
      "collect-results",
    ]);
  });
});

describe("TEST_PIPELINE", () => {
  test("has exactly 5 stages", () => {
    expect(TEST_PIPELINE).toHaveLength(5);
  });

  test("stages are in correct order", () => {
    const types = TEST_PIPELINE.map((s) => s.type);
    expect(types).toEqual([
      "spawn-drone",
      "wait-completion",
      "run-command",
      "collect-results",
      "health-check",
    ]);
  });

  test("health-check has on_fail: skip", () => {
    const healthCheck = TEST_PIPELINE.find((s) => s.type === "health-check");
    expect(healthCheck?.on_fail).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// getTemplate tests
// ---------------------------------------------------------------------------

describe("getTemplate", () => {
  test("returns CODE_PIPELINE for 'code'", () => {
    expect(getTemplate("code")).toBe(CODE_PIPELINE);
  });

  test("returns BUILD_PIPELINE for 'build'", () => {
    expect(getTemplate("build")).toBe(BUILD_PIPELINE);
  });

  test("returns TEST_PIPELINE for 'test'", () => {
    expect(getTemplate("test")).toBe(TEST_PIPELINE);
  });

  test("returns undefined for unknown template", () => {
    expect(getTemplate("unknown")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(getTemplate("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolvePipeline tests
// ---------------------------------------------------------------------------

describe("resolvePipeline", () => {
  test("returns CODE_PIPELINE by default (no pipeline or template)", () => {
    const desc = makeMind();
    expect(resolvePipeline(desc)).toBe(CODE_PIPELINE);
  });

  test("explicit pipeline takes highest priority", () => {
    const customPipeline = [
      { type: "spawn-drone" },
      { type: "run-command" },
    ];
    const desc = makeMind({
      pipeline: customPipeline,
      pipeline_template: "build", // should be ignored
    });
    expect(resolvePipeline(desc)).toEqual(customPipeline);
  });

  test("pipeline_template resolves to correct template", () => {
    const desc = makeMind({ pipeline_template: "build" });
    expect(resolvePipeline(desc)).toBe(BUILD_PIPELINE);
  });

  test("pipeline_template 'test' resolves to TEST_PIPELINE", () => {
    const desc = makeMind({ pipeline_template: "test" });
    expect(resolvePipeline(desc)).toBe(TEST_PIPELINE);
  });

  test("pipeline_template 'code' resolves to CODE_PIPELINE", () => {
    const desc = makeMind({ pipeline_template: "code" });
    expect(resolvePipeline(desc)).toBe(CODE_PIPELINE);
  });

  test("throws for unknown pipeline_template", () => {
    const desc = makeMind({ pipeline_template: "deploy" });
    expect(() => resolvePipeline(desc)).toThrow('Unknown pipeline template "deploy"');
  });

  test("empty pipeline array falls through to template", () => {
    const desc = makeMind({
      pipeline: [],
      pipeline_template: "build",
    });
    expect(resolvePipeline(desc)).toBe(BUILD_PIPELINE);
  });

  test("empty pipeline array with no template defaults to code", () => {
    const desc = makeMind({ pipeline: [] });
    expect(resolvePipeline(desc)).toBe(CODE_PIPELINE);
  });

  test("explicit pipeline is not modified (returns same reference)", () => {
    const customPipeline = [{ type: "custom-stage" }];
    const desc = makeMind({ pipeline: customPipeline });
    expect(resolvePipeline(desc)).toBe(customPipeline);
  });
});

// ---------------------------------------------------------------------------
// producesCode tests
// ---------------------------------------------------------------------------

describe("producesCode", () => {
  test("returns true for default (code) pipeline", () => {
    expect(producesCode(makeMind())).toBe(true);
  });

  test("returns true for explicit code template", () => {
    expect(producesCode(makeMind({ pipeline_template: "code" }))).toBe(true);
  });

  test("returns false for build template", () => {
    expect(producesCode(makeMind({ pipeline_template: "build" }))).toBe(false);
  });

  test("returns false for test template", () => {
    expect(producesCode(makeMind({ pipeline_template: "test" }))).toBe(false);
  });

  test("returns true for custom pipeline with code stages", () => {
    expect(
      producesCode(
        makeMind({
          pipeline: [
            { type: "spawn-drone" },
            { type: "git-diff" },
            { type: "llm-review" },
          ],
        })
      )
    ).toBe(true);
  });

  test("returns false for custom pipeline without code stages", () => {
    const desc = makeMind({
      pipeline: [
        { type: "spawn-drone" },
        { type: "run-command" },
        { type: "collect-results" },
      ],
    });
    expect(producesCode(desc)).toBe(false);
  });
});
