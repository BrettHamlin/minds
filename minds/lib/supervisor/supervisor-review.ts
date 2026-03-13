/**
 * supervisor-review.ts — Review prompt construction, verdict parsing,
 * and feedback file generation for the deterministic Mind supervisor.
 */

import type { MindTask } from "../../cli/lib/implement-types.ts";
import { formatTaskList } from "../../cli/lib/drone-brief.ts";
import type { ReviewFinding, ReviewVerdict } from "./supervisor-types.ts";
import { MAX_DIFF_CHARS, MAX_TEST_OUTPUT_CHARS } from "./supervisor-types.ts";

// ---------------------------------------------------------------------------
// Shared Review Constants & Utilities
// ---------------------------------------------------------------------------

export function truncateWithLabel(text: string, maxChars: number, label: string): string {
  if (text.length > maxChars) {
    return text.slice(0, maxChars) + `\n\n[truncated — ${label}]`;
  }
  return text;
}

export const REVIEW_CHECKLIST: readonly string[] = [
  "All assigned tasks are implemented",
  "No duplicated logic — DRY principle respected",
  "All tests pass (check the test output provided)",
  "All new exported functions have tests",
  "No dead code or unused imports",
  "Error messages include sufficient context",
  "Code follows project conventions",
];

export const BUILD_REVIEW_CHECKLIST: readonly string[] = [
  "All assigned tasks are implemented",
  "Build completed successfully",
  "All expected artifacts produced",
  "Error messages include sufficient context",
  "Code follows project conventions",
];

export const TEST_REVIEW_CHECKLIST: readonly string[] = [
  "All assigned tasks are implemented",
  "Test suite executed successfully",
  "All results reported clearly",
  "Error messages include sufficient context",
  "Code follows project conventions",
];

export function formatReviewChecklist(pipelineTemplate?: string): string {
  let checklist: readonly string[];
  if (pipelineTemplate === "build") {
    checklist = BUILD_REVIEW_CHECKLIST;
  } else if (pipelineTemplate === "test") {
    checklist = TEST_REVIEW_CHECKLIST;
  } else {
    checklist = REVIEW_CHECKLIST;
  }
  return checklist.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

function prepareReviewInputs(diff: string, testOutput: string, tasks: MindTask[]) {
  return {
    truncatedDiff: truncateWithLabel(diff, MAX_DIFF_CHARS, "diff exceeded 50k chars"),
    truncatedTestOutput: truncateWithLabel(testOutput, MAX_TEST_OUTPUT_CHARS, "test output exceeded 20k chars"),
    taskList: formatTaskList(tasks, { style: "review" }),
  };
}

export const REVIEW_RESPONSE_FORMAT = `Respond with ONLY a JSON object. Do NOT wrap it in markdown code fences. Do NOT include any explanation outside the JSON.

{
  "approved": true | false,
  "findings": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "severity": "error" | "warning",
      "message": "Description of the issue"
    }
  ]
}

If approved, findings must be an empty array.
If any issue is found, set approved to false and list all findings.`;

// ---------------------------------------------------------------------------
// Review Prompt Construction
// ---------------------------------------------------------------------------

/**
 * Parameters for the standalone review prompt (`buildReviewPrompt`).
 *
 * NOTE: The production code path uses `AgentReviewPromptParams` + Mind Agent.
 * This interface is retained for the non-agent fallback path.
 */
export interface ReviewPromptParams {
  diff: string;
  testOutput: string;
  standards: string;
  tasks: MindTask[];
  iteration: number;
  previousFeedback?: string;
  pipelineTemplate?: string;
}

/**
 * Build a standalone review prompt for direct `claude -p` invocation (non-agent path).
 *
 * NOTE: The production code path uses `buildAgentReviewPrompt` + Mind Agent.
 * This function is retained as a fallback for non-agent review scenarios.
 */
export function buildReviewPrompt(params: ReviewPromptParams): string {
  const { diff, testOutput, standards, tasks, iteration, previousFeedback, pipelineTemplate } = params;

  const { truncatedDiff, truncatedTestOutput, taskList } = prepareReviewInputs(diff, testOutput, tasks);

  const previousSection = previousFeedback
    ? `\n## Previous Feedback (for context)\n\n${previousFeedback}\n`
    : "";

  const checklist = formatReviewChecklist(pipelineTemplate);

  return `You are reviewing code changes for iteration ${iteration} of a drone implementation cycle.

## Tasks Assigned

${taskList}

## Git Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Test Results

\`\`\`
${truncatedTestOutput}
\`\`\`

## Engineering Standards

${standards}
${previousSection}
## Instructions

Review the diff against the tasks and engineering standards. Check:
${checklist}

${REVIEW_RESPONSE_FORMAT}

If any issue is found (even minor ones like unused imports), set approved to false and list all findings.`;
}

// ---------------------------------------------------------------------------
// Agent Review Prompt (lean — data only, no standards/instructions)
// ---------------------------------------------------------------------------

export interface AgentReviewPromptParams {
  diff: string;
  testOutput: string;
  tasks: MindTask[];
  iteration: number;
}

/**
 * Build a lean review prompt for the Mind Agent.
 *
 * Unlike buildReviewPrompt, this only contains the data payload (diff, tests,
 * tasks, iteration). Standards, review instructions, and response format live
 * in the agent file (.claude/agents/Mind.md) so they become the agent's system
 * prompt rather than competing with the data in the user message.
 */
export function buildAgentReviewPrompt(params: AgentReviewPromptParams): string {
  const { diff, testOutput, tasks, iteration } = params;

  const { truncatedDiff, truncatedTestOutput, taskList } = prepareReviewInputs(diff, testOutput, tasks);

  return `Review iteration ${iteration}.

## Tasks Assigned

${taskList}

## Git Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Test Results

\`\`\`
${truncatedTestOutput}
\`\`\``;
}

// ---------------------------------------------------------------------------
// Verdict Parsing
// ---------------------------------------------------------------------------

export function parseReviewVerdict(raw: string): ReviewVerdict {
  // Strategy 1: Try direct JSON parse
  try {
    const parsed = JSON.parse(raw);
    return normalizeVerdict(parsed);
  } catch {
    // Not direct JSON
  }

  // Strategy 2: Extract from markdown code block
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1]);
      return normalizeVerdict(parsed);
    } catch {
      // Code block wasn't valid JSON
    }
  }

  // Strategy 3: Find JSON object in the text
  const jsonMatch = raw.match(/\{[\s\S]*"approved"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return normalizeVerdict(parsed);
    } catch {
      // Matched something that looked like JSON but wasn't
    }
  }

  // Fallback: unparseable response => treat as rejection
  return {
    approved: false,
    findings: [
      {
        file: "(review)",
        line: 0,
        severity: "error",
        message: `Failed to parse review verdict from LLM response. Raw response starts with: "${raw.slice(0, 100)}..."`,
      },
    ],
  };
}

function normalizeVerdict(parsed: Record<string, unknown>): ReviewVerdict {
  const approved = parsed.approved === true;
  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings: ReviewFinding[] = rawFindings.map((f: Record<string, unknown>) => ({
    file: String(f.file ?? "(unknown)"),
    line: typeof f.line === "number" ? f.line : 0,
    severity: f.severity === "warning" ? "warning" : "error",
    message: String(f.message ?? "(no message)"),
  }));

  return { approved, findings };
}

// ---------------------------------------------------------------------------
// Feedback File Generation
// ---------------------------------------------------------------------------

export function buildFeedbackContent(
  round: number,
  findings: ReviewFinding[],
  testFailures?: string,
): string {
  let content = `# Review Feedback (Round ${round})\n\n`;
  content += `Your changes were reviewed and need fixes before approval. `;
  content += `Address each finding below, then commit your fixes.\n\n`;

  if (testFailures) {
    content += `## Test Failures\n\n`;
    content += `The following tests are failing. Fix them before resubmitting.\n\n`;
    content += `\`\`\`\n${testFailures}\n\`\`\`\n\n`;
  }

  if (findings.length > 0) {
    // Categorize findings for clearer feedback
    const boundaryFindings = findings.filter((f) => f.message.includes("outside your boundary") || f.message.includes("infrastructure file"));
    const otherFindings = findings.filter((f) => !boundaryFindings.includes(f));

    if (boundaryFindings.length > 0) {
      content += `## Boundary Violations\n\n`;
      content += `You modified files outside your allowed scope. `;
      content += `**Revert these changes** — use \`git checkout -- <file>\` to undo them. `;
      content += `If a task requires files outside your boundary, skip that task.\n\n`;
      for (const f of boundaryFindings) {
        content += `- ${f.file} — ${f.message}\n`;
      }
      content += `\n`;
    }

    if (otherFindings.length > 0) {
      content += `## Code Review Findings\n\n`;
      for (const f of otherFindings) {
        const severity = f.severity === "error" ? "**Error**" : "Warning";
        content += `- ${severity}: ${f.file}:${f.line} — ${f.message}\n`;
      }
    }
  }

  return content;
}
