/**
 * supervisor-review-pipeline.test.ts — Tests for pipeline-aware review prompt construction.
 *
 * BRE-624: Non-code pipelines (build, test) should get different review checklists.
 * Code pipeline and default (undefined) must keep current behavior exactly.
 */

import { describe, test, expect } from "bun:test";
import {
  buildReviewPrompt,
  REVIEW_CHECKLIST,
  type ReviewPromptParams,
} from "../supervisor-review.ts";
import type { MindTask } from "../../../cli/lib/implement-types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleTasks: MindTask[] = [
  { id: "T001", mind: "builder", description: "Run build", parallel: false },
];

const baseParams: ReviewPromptParams = {
  diff: "diff --git a/Makefile b/Makefile\n+build: all",
  testOutput: "Build succeeded",
  standards: "Follow project conventions.",
  tasks: sampleTasks,
  iteration: 1,
};

// ---------------------------------------------------------------------------
// Code pipeline (default)
// ---------------------------------------------------------------------------

describe("buildReviewPrompt — code pipeline (default)", () => {
  test("contains standard code review checklist items", () => {
    const prompt = buildReviewPrompt(baseParams);
    expect(prompt).toContain("All new exported functions have tests");
    expect(prompt).toContain("No dead code or unused imports");
  });

  test("explicit code pipeline matches default", () => {
    const defaultPrompt = buildReviewPrompt(baseParams);
    const codePrompt = buildReviewPrompt({ ...baseParams, pipelineTemplate: "code" });
    expect(defaultPrompt).toBe(codePrompt);
  });
});

// ---------------------------------------------------------------------------
// Build pipeline
// ---------------------------------------------------------------------------

describe("buildReviewPrompt — build pipeline", () => {
  test("omits code-specific checklist items", () => {
    const prompt = buildReviewPrompt({ ...baseParams, pipelineTemplate: "build" });
    expect(prompt).not.toContain("All new exported functions have tests");
    expect(prompt).not.toContain("No dead code or unused imports");
  });

  test("includes build-specific checklist items", () => {
    const prompt = buildReviewPrompt({ ...baseParams, pipelineTemplate: "build" });
    expect(prompt).toContain("Build completed successfully");
    expect(prompt).toContain("expected artifacts produced");
  });

  test("still contains common items", () => {
    const prompt = buildReviewPrompt({ ...baseParams, pipelineTemplate: "build" });
    expect(prompt).toContain("All assigned tasks are implemented");
  });
});

// ---------------------------------------------------------------------------
// Test pipeline
// ---------------------------------------------------------------------------

describe("buildReviewPrompt — test pipeline", () => {
  test("omits code-specific checklist items", () => {
    const prompt = buildReviewPrompt({ ...baseParams, pipelineTemplate: "test" });
    expect(prompt).not.toContain("All new exported functions have tests");
    expect(prompt).not.toContain("No dead code or unused imports");
  });

  test("includes test-specific checklist items", () => {
    const prompt = buildReviewPrompt({ ...baseParams, pipelineTemplate: "test" });
    expect(prompt).toContain("Test suite executed");
    expect(prompt).toContain("results reported");
  });

  test("still contains common items", () => {
    const prompt = buildReviewPrompt({ ...baseParams, pipelineTemplate: "test" });
    expect(prompt).toContain("All assigned tasks are implemented");
  });
});
