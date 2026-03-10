/**
 * supervisor-review.ts — Review prompt construction, verdict parsing,
 * and feedback file generation for the deterministic Mind supervisor.
 */

import type { MindTask } from "../cli/lib/implement-types.ts";
import type { ReviewFinding, ReviewVerdict } from "./supervisor-types.ts";
import { MAX_DIFF_CHARS } from "./supervisor-types.ts";

// ---------------------------------------------------------------------------
// Review Prompt Construction
// ---------------------------------------------------------------------------

export interface ReviewPromptParams {
  diff: string;
  testOutput: string;
  standards: string;
  tasks: MindTask[];
  iteration: number;
  previousFeedback?: string;
}

export function buildReviewPrompt(params: ReviewPromptParams): string {
  const { diff, testOutput, standards, tasks, iteration, previousFeedback } = params;

  // Truncate very large diffs to avoid exceeding context limits
  let truncatedDiff = diff;
  if (diff.length > MAX_DIFF_CHARS) {
    truncatedDiff = diff.slice(0, MAX_DIFF_CHARS) + "\n\n[truncated — diff exceeded 50k chars]";
  }

  const taskList = tasks
    .map((t) => `- ${t.id}: ${t.description}`)
    .join("\n");

  const previousSection = previousFeedback
    ? `\n## Previous Feedback (for context)\n\n${previousFeedback}\n`
    : "";

  return `You are reviewing code changes for iteration ${iteration} of a drone implementation cycle.

## Tasks Assigned

${taskList}

## Git Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Test Results

\`\`\`
${testOutput}
\`\`\`

## Engineering Standards

${standards}
${previousSection}
## Instructions

Review the diff against the tasks and engineering standards. Check:
1. All tasks are implemented
2. No files modified outside the mind's boundary
3. No duplicated logic
4. All new exported functions have tests
5. All tests pass (check the test output above)
6. No lint errors or dead code
7. Error messages include context

Respond with ONLY a JSON object (no markdown, no explanation) in this exact format:

\`\`\`json
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
\`\`\`

If approved, findings should be an empty array.
If any issue is found (even minor ones like unused imports), set approved to false and list all findings.`;
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

  if (testFailures) {
    content += `## Test Failures\n\n\`\`\`\n${testFailures}\n\`\`\`\n\n`;
  }

  if (findings.length > 0) {
    content += `## Findings\n\n`;
    for (const f of findings) {
      const severity = f.severity === "error" ? "[ERROR]" : "[WARNING]";
      content += `- [ ] ${severity} ${f.file}:${f.line} — ${f.message}\n`;
    }
  }

  return content;
}
