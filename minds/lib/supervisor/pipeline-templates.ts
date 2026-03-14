/**
 * pipeline-templates.ts — Pre-built pipeline templates and resolution logic.
 *
 * Templates are TypeScript constants — arrays of PipelineStage. Fission selects
 * templates deterministically based on project type. Minds can also declare
 * explicit pipelines to override templates entirely.
 *
 * Resolution order: explicit `pipeline` > `pipeline_template` > default "code"
 */

import type { PipelineStage } from "./pipeline-types.ts";
import type { MindDescription } from "../../mind.ts";

// ---------------------------------------------------------------------------
// Pipeline templates
// ---------------------------------------------------------------------------

/**
 * CODE_PIPELINE — Matches the current hardcoded supervisor behavior exactly.
 *
 * Stages: spawn-drone → wait-completion → git-diff → run-tests →
 *         boundary-check → contract-check → llm-review
 */
export const CODE_PIPELINE: readonly PipelineStage[] = [
  { type: "spawn-drone", label: "Spawn Drone" },
  { type: "wait-completion", label: "Wait for Drone Completion" },
  { type: "git-diff", label: "Git Diff" },
  { type: "run-tests", label: "Run Tests" },
  { type: "boundary-check", label: "Boundary Check" },
  { type: "contract-check", label: "Contract Check" },
  { type: "llm-review", label: "LLM Review" },
] as const;

/**
 * BUILD_PIPELINE — For build minds that compile/deploy code.
 *
 * Stages: spawn-drone → wait-completion → run-command → collect-results
 */
export const BUILD_PIPELINE: readonly PipelineStage[] = [
  { type: "spawn-drone", label: "Spawn Drone" },
  { type: "wait-completion", label: "Wait for Drone Completion" },
  { type: "run-command", label: "Run Build Command" },
  { type: "collect-results", label: "Collect Build Results" },
] as const;

/**
 * TEST_PIPELINE — For test/verify minds that validate deployments.
 *
 * Stages: spawn-drone → wait-completion → run-command → collect-results →
 *         health-check (optional, default skip on failure)
 */
export const TEST_PIPELINE: readonly PipelineStage[] = [
  { type: "spawn-drone", label: "Spawn Drone" },
  { type: "wait-completion", label: "Wait for Drone Completion" },
  { type: "run-command", label: "Run Test Command" },
  { type: "collect-results", label: "Collect Test Results" },
  { type: "health-check", label: "Health Check", on_fail: "skip" },
] as const;

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const TEMPLATE_MAP: Record<string, readonly PipelineStage[]> = {
  code: CODE_PIPELINE,
  build: BUILD_PIPELINE,
  test: TEST_PIPELINE,
};

/**
 * Look up a pipeline template by name.
 * Returns undefined for unknown template names.
 */
export function getTemplate(name: string): readonly PipelineStage[] | undefined {
  return TEMPLATE_MAP[name];
}

// ---------------------------------------------------------------------------
// Code-production detection
// ---------------------------------------------------------------------------

/** Stage types that indicate code production (merge, TDD, boundary enforcement). */
const CODE_STAGE_TYPES = new Set([
  "git-diff",
  "run-tests",
  "boundary-check",
  "contract-check",
  "llm-review",
]);

/**
 * Determine whether a MindDescription's resolved pipeline includes code-production stages.
 * Returns true when the pipeline contains stages associated with code output
 * (git-diff, run-tests, boundary-check, contract-check, llm-review).
 *
 * Used to decide whether to run code-specific operations like merge,
 * TDD-style drone briefs, and file boundary enforcement.
 */
export function producesCode(desc: MindDescription): boolean {
  const pipeline = resolvePipeline(desc);
  return pipeline.some((stage) => CODE_STAGE_TYPES.has(stage.type));
}

// ---------------------------------------------------------------------------
// Pipeline resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the pipeline for a mind, using the resolution order:
 *   1. Explicit `pipeline` array (mind declares exact stages)
 *   2. `pipeline_template` string (e.g. "build" → BUILD_PIPELINE)
 *   3. Default: CODE_PIPELINE (backward compatible — all existing minds)
 *
 * Throws if `pipeline_template` references an unknown template name.
 */
export function resolvePipeline(desc: MindDescription): readonly PipelineStage[] {
  // 1. Explicit pipeline takes highest priority
  if (desc.pipeline && desc.pipeline.length > 0) {
    return desc.pipeline;
  }

  // 2. Named template
  if (desc.pipeline_template) {
    const template = getTemplate(desc.pipeline_template);
    if (!template) {
      throw new Error(
        `Unknown pipeline template "${desc.pipeline_template}" for mind "${desc.name}". ` +
        `Available templates: ${Object.keys(TEMPLATE_MAP).join(", ")}`
      );
    }
    return template;
  }

  // 3. Default: code pipeline (backward compatible)
  return CODE_PIPELINE;
}
