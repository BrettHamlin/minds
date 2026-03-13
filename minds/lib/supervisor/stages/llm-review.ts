/**
 * llm-review.ts — Stage executor for LLM code review.
 *
 * Reads previous feedback files, builds a review prompt, calls the LLM,
 * parses the verdict, and applies force-rejections from deterministic checks.
 *
 * Also exports applyForceRejections as a shared helper since both this
 * stage and mind-supervisor.ts need it.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";
import type { CheckResults, ReviewVerdict } from "../supervisor-types.ts";
import { DEFAULT_REVIEW_TIMEOUT_MS, errorMessage } from "../supervisor-types.ts";
import { buildReviewPrompt, parseReviewVerdict } from "../supervisor-review.ts";

// ---------------------------------------------------------------------------
// Force-rejection helper (deterministic checks override LLM verdict)
// ---------------------------------------------------------------------------

/**
 * Apply force-rejections: deterministic checks override the LLM verdict.
 *
 * - If tests fail and LLM approved, reject with test failure finding.
 * - If boundary fails and LLM approved, reject with boundary findings.
 * - If boundary passes, strip any false LLM boundary findings.
 * - If contracts fail and LLM approved, reject with contract findings.
 */
export function applyForceRejections(verdict: ReviewVerdict, checks: CheckResults): void {
  if (!checks.testsPass && verdict.approved) {
    verdict.approved = false;
    verdict.findings.push({
      file: "(tests)",
      line: 0,
      severity: "error",
      message: "Tests are failing. Fix all test failures before approval.",
    });
  }
  if (checks.boundaryPass === false && verdict.approved) {
    verdict.approved = false;
    verdict.findings.push(...(checks.boundaryFindings ?? []));
  } else if (checks.boundaryPass === true) {
    // Deterministic boundary check passed — strip any false LLM boundary findings.
    const before = verdict.findings.length;
    verdict.findings = verdict.findings.filter(
      (f) => !f.message.includes("boundary") && !f.message.includes("outside")
    );
    // If LLM rejected ONLY for boundary and we stripped all those findings, re-approve.
    if (!verdict.approved && before > 0 && verdict.findings.length === 0) {
      verdict.approved = true;
    }
  }
  if (checks.contractsPass === false && verdict.approved) {
    verdict.approved = false;
    verdict.findings.push(...(checks.contractFindings ?? []));
  }
}

// ---------------------------------------------------------------------------
// LLM Review Stage Executor
// ---------------------------------------------------------------------------

export const executeLlmReview = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { deps, supervisorConfig: config, iteration, worktree, checkResults, standards } = ctx;
  const reviewTimeoutMs = config.reviewTimeoutMs ?? DEFAULT_REVIEW_TIMEOUT_MS;

  if (!checkResults) {
    return {
      ok: false,
      error: "No check results available — git-diff stage must run first",
    };
  }

  // Read ALL previous feedback files for the reviewer's context
  let previousFeedback: string | undefined;
  if (iteration > 1) {
    const feedbackParts: string[] = [];
    for (let i = 1; i < iteration; i++) {
      const fbPath = join(worktree, `REVIEW-FEEDBACK-${i}.md`);
      if (existsSync(fbPath)) {
        feedbackParts.push(readFileSync(fbPath, "utf-8"));
      }
    }
    if (feedbackParts.length > 0) {
      previousFeedback = feedbackParts.join("\n\n---\n\n");
    }
  }
  ctx.previousFeedback = previousFeedback;

  // Build review prompt (pipeline-aware checklist via BRE-624)
  const prompt = buildReviewPrompt({
    diff: checkResults.diff,
    testOutput: checkResults.testOutput,
    standards,
    tasks: config.tasks,
    iteration,
    previousFeedback,
    pipelineTemplate: config.pipelineTemplate,
  });

  // Call LLM for review
  let verdict: ReviewVerdict;
  try {
    const rawResponse = await deps.callLlmReview(prompt, reviewTimeoutMs, {
      worktreePath: worktree,
    });
    verdict = parseReviewVerdict(rawResponse);
  } catch (err) {
    verdict = {
      approved: false,
      findings: [{
        file: "(review)",
        line: 0,
        severity: "error",
        message: `LLM review failed: ${errorMessage(err)}`,
      }],
    };
  }

  // Deterministic checks override LLM verdict
  applyForceRejections(verdict, checkResults);

  ctx.verdict = verdict;

  return {
    ok: verdict.approved,
    approved: verdict.approved,
    findings: verdict.findings,
  };
};
