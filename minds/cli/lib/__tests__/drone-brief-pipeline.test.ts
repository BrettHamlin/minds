/**
 * drone-brief-pipeline.test.ts — Tests for pipeline-aware drone brief construction.
 *
 * BRE-624: When pipelineTemplate is "build" or "test", the drone brief should
 * omit TDD instructions and include pipeline-specific instructions instead.
 * When undefined or "code", behavior must be identical to current.
 */

import { describe, test, expect } from "bun:test";
import { buildDroneBrief, type DroneBriefParams } from "../drone-brief.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseParams: DroneBriefParams = {
  ticketId: "BRE-624",
  mindName: "test_mind",
  waveId: "w1",
  tasks: [
    { id: "T001", mind: "test_mind", description: "Implement feature", parallel: false },
  ],
  dependencies: [],
  featureDir: "features/BRE-624",
  mindsDir: "/repo/minds",
  ownsFiles: ["src/test/**"],
};

// ---------------------------------------------------------------------------
// Code pipeline (default behavior)
// ---------------------------------------------------------------------------

describe("buildDroneBrief — code pipeline (default)", () => {
  test("contains TDD instructions when pipelineTemplate is undefined", () => {
    const brief = buildDroneBrief(baseParams);
    expect(brief).toContain("Write tests for each change");
    expect(brief).toContain("TDD");
  });

  test("contains TDD instructions when pipelineTemplate is 'code'", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "code" });
    expect(brief).toContain("Write tests for each change");
    expect(brief).toContain("TDD");
  });

  test("contains file boundary section when pipelineTemplate is undefined", () => {
    const brief = buildDroneBrief(baseParams);
    expect(brief).toContain("File Boundary");
    expect(brief).toContain("src/test/**");
  });

  test("contains test command when pipelineTemplate is undefined", () => {
    const brief = buildDroneBrief(baseParams);
    expect(brief).toContain("bun test");
  });

  test("default (undefined) matches code pipeline behavior", () => {
    const defaultBrief = buildDroneBrief(baseParams);
    const codeBrief = buildDroneBrief({ ...baseParams, pipelineTemplate: "code" });
    expect(defaultBrief).toBe(codeBrief);
  });
});

// ---------------------------------------------------------------------------
// Build pipeline
// ---------------------------------------------------------------------------

describe("buildDroneBrief — build pipeline", () => {
  test("omits TDD instructions", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "build" });
    expect(brief).not.toContain("TDD");
    expect(brief).not.toContain("Write tests for each change");
  });

  test("omits file boundary enforcement", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "build" });
    expect(brief).not.toContain("File Boundary");
    expect(brief).not.toContain("boundary check");
  });

  test("includes build-specific instructions", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "build" });
    expect(brief).toContain("build commands");
    expect(brief).toContain("MIND.md");
  });

  test("still contains task list", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "build" });
    expect(brief).toContain("T001");
    expect(brief).toContain("Implement feature");
  });

  test("still contains ticket reference", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "build" });
    expect(brief).toContain("BRE-624");
  });
});

// ---------------------------------------------------------------------------
// Test pipeline
// ---------------------------------------------------------------------------

describe("buildDroneBrief — test pipeline", () => {
  test("omits TDD instructions", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "test" });
    expect(brief).not.toContain("TDD");
    expect(brief).not.toContain("Write tests for each change");
  });

  test("omits file boundary enforcement", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "test" });
    expect(brief).not.toContain("File Boundary");
    expect(brief).not.toContain("boundary check");
  });

  test("includes test-specific instructions", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "test" });
    expect(brief).toContain("test/verification commands");
    expect(brief).toContain("MIND.md");
  });

  test("still contains task list", () => {
    const brief = buildDroneBrief({ ...baseParams, pipelineTemplate: "test" });
    expect(brief).toContain("T001");
    expect(brief).toContain("Implement feature");
  });
});
