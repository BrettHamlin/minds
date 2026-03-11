/**
 * supervisor-review.test.ts — Tests for review prompt construction,
 * verdict parsing, and feedback generation.
 */

import { describe, test, expect } from "bun:test";
import type { ReviewFinding, SupervisorConfig } from "../supervisor-types.ts";
import { buildReviewPrompt, parseReviewVerdict, buildFeedbackContent } from "../supervisor-review.ts";
import type { MindTask } from "../../../cli/lib/implement-types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleTasks: MindTask[] = [
  { id: "T001", mind: "transport", description: "Implement SSE endpoint", parallel: false },
  { id: "T002", mind: "transport", description: "Add reconnection logic", parallel: false },
];

const sampleDiff = `diff --git a/src/sse.ts b/src/sse.ts
new file mode 100644
--- /dev/null
+++ b/src/sse.ts
@@ -0,0 +1,20 @@
+export function createSSEHandler() {
+  return (req: Request) => {
+    const stream = new ReadableStream({
+      start(controller) {
+        controller.enqueue("data: hello\\n\\n");
+      }
+    });
+    return new Response(stream);
+  };
+}`;

const sampleTestOutput = `bun test v1.2.3

minds/transport/sse.test.ts:
(pass) SSE handler > returns streaming response [2.31ms]
(pass) SSE handler > sends correct content type [0.42ms]

 2 pass
 0 fail
 3 expect() calls
Ran 2 tests across 1 files. [0.45s]`;

const sampleStandards = `## Review Checklist
- [ ] All tasks completed
- [ ] No files modified outside owns_files
- [ ] All new exported functions have tests
- [ ] All tests pass`;

// ---------------------------------------------------------------------------
// Review Prompt Construction
// ---------------------------------------------------------------------------

describe("buildReviewPrompt", () => {
  test("includes diff in prompt", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 1,
    });
    expect(prompt).toContain("diff --git");
    expect(prompt).toContain("src/sse.ts");
  });

  test("includes test output in prompt", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 1,
    });
    expect(prompt).toContain("2 pass");
    expect(prompt).toContain("0 fail");
  });

  test("includes standards in prompt", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 1,
    });
    expect(prompt).toContain("Review Checklist");
    expect(prompt).toContain("All tasks completed");
  });

  test("includes task descriptions in prompt", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 1,
    });
    expect(prompt).toContain("T001");
    expect(prompt).toContain("Implement SSE endpoint");
    expect(prompt).toContain("T002");
  });

  test("asks for JSON response format", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 1,
    });
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("approved");
    expect(prompt).toContain("findings");
  });

  test("includes iteration number", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 2,
    });
    expect(prompt).toContain("iteration 2");
  });

  test("truncates very large diffs", () => {
    const hugeDiff = "a\n".repeat(100_000);
    const prompt = buildReviewPrompt({
      diff: hugeDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 1,
    });
    expect(prompt.length).toBeLessThan(200_000);
    expect(prompt).toContain("[truncated");
  });

  test("includes previousFeedback when provided", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 2,
      previousFeedback: "## Round 1 findings\n- Missing error handling in sse.ts",
    });
    expect(prompt).toContain("Previous Feedback");
    expect(prompt).toContain("Missing error handling in sse.ts");
  });

  test("does not include previousFeedback section when not provided", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 1,
    });
    expect(prompt).not.toContain("Previous Feedback");
  });

  test("includes all previous feedback separated by dividers", () => {
    const allFeedback = [
      "# Round 1\n- Missing tests",
      "# Round 2\n- Unused import",
    ].join("\n\n---\n\n");

    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: sampleTasks,
      iteration: 3,
      previousFeedback: allFeedback,
    });

    expect(prompt).toContain("Previous Feedback");
    expect(prompt).toContain("Round 1");
    expect(prompt).toContain("Missing tests");
    expect(prompt).toContain("Round 2");
    expect(prompt).toContain("Unused import");
  });
});

// ---------------------------------------------------------------------------
// Verdict Parsing
// ---------------------------------------------------------------------------

describe("parseReviewVerdict", () => {
  test("parses approved verdict", () => {
    const raw = JSON.stringify({ approved: true, findings: [] });
    const verdict = parseReviewVerdict(raw);
    expect(verdict.approved).toBe(true);
    expect(verdict.findings).toEqual([]);
  });

  test("parses rejected verdict with findings", () => {
    const findings: ReviewFinding[] = [
      { file: "src/sse.ts", line: 5, severity: "error", message: "Missing error handling" },
      { file: "src/sse.ts", line: 12, severity: "warning", message: "Could use const" },
    ];
    const raw = JSON.stringify({ approved: false, findings });
    const verdict = parseReviewVerdict(raw);
    expect(verdict.approved).toBe(false);
    expect(verdict.findings).toHaveLength(2);
    expect(verdict.findings[0].severity).toBe("error");
    expect(verdict.findings[1].severity).toBe("warning");
  });

  test("extracts JSON from markdown code block", () => {
    const raw = `Here is my review:

\`\`\`json
{
  "approved": false,
  "findings": [
    { "file": "src/sse.ts", "line": 5, "severity": "error", "message": "Missing error handling" }
  ]
}
\`\`\``;
    const verdict = parseReviewVerdict(raw);
    expect(verdict.approved).toBe(false);
    expect(verdict.findings).toHaveLength(1);
  });

  test("handles response with extra text around JSON", () => {
    const raw = `The code looks mostly good but I found one issue.

{"approved": false, "findings": [{"file": "a.ts", "line": 1, "severity": "error", "message": "bug"}]}

That's my review.`;
    const verdict = parseReviewVerdict(raw);
    expect(verdict.approved).toBe(false);
    expect(verdict.findings).toHaveLength(1);
  });

  test("returns disapproved verdict for unparseable response", () => {
    const verdict = parseReviewVerdict("This is not JSON at all, just rambling text about code.");
    expect(verdict.approved).toBe(false);
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0].severity).toBe("error");
    expect(verdict.findings[0].message).toContain("Failed to parse");
  });

  test("handles missing findings array gracefully", () => {
    const raw = JSON.stringify({ approved: true });
    const verdict = parseReviewVerdict(raw);
    expect(verdict.approved).toBe(true);
    expect(verdict.findings).toEqual([]);
  });

  test("defaults severity to error when missing", () => {
    const raw = JSON.stringify({
      approved: false,
      findings: [{ file: "a.ts", line: 1, message: "bad" }],
    });
    const verdict = parseReviewVerdict(raw);
    expect(verdict.findings[0].severity).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Feedback File Generation
// ---------------------------------------------------------------------------

describe("buildFeedbackContent", () => {
  test("includes round number in header", () => {
    const content = buildFeedbackContent(1, [
      { file: "src/sse.ts", line: 5, severity: "error", message: "Missing error handling" },
    ]);
    expect(content).toContain("Round 1");
  });

  test("formats findings as checklist items", () => {
    const content = buildFeedbackContent(2, [
      { file: "src/sse.ts", line: 5, severity: "error", message: "Missing error handling" },
      { file: "src/sse.ts", line: 12, severity: "warning", message: "Use const" },
    ]);
    expect(content).toContain("- [ ]");
    expect(content).toContain("src/sse.ts:5");
    expect(content).toContain("Missing error handling");
    expect(content).toContain("src/sse.ts:12");
    expect(content).toContain("Use const");
  });

  test("includes severity label", () => {
    const content = buildFeedbackContent(1, [
      { file: "a.ts", line: 1, severity: "error", message: "critical bug" },
      { file: "b.ts", line: 2, severity: "warning", message: "minor issue" },
    ]);
    expect(content).toContain("[ERROR]");
    expect(content).toContain("[WARNING]");
  });

  test("handles empty findings array", () => {
    const content = buildFeedbackContent(1, []);
    expect(content).toContain("Round 1");
    expect(content).not.toContain("- [ ]");
  });

  test("includes test failure info when provided", () => {
    const content = buildFeedbackContent(1, [
      { file: "src/sse.ts", line: 5, severity: "error", message: "Missing error handling" },
    ], "1 fail\nExpected: 200, Received: 500");
    expect(content).toContain("Test Failures");
    expect(content).toContain("Expected: 200");
  });
});
