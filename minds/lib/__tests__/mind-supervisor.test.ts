/**
 * mind-supervisor.test.ts -- Tests for the deterministic Mind supervisor.
 *
 * Tests the state machine, review prompt construction, verdict parsing,
 * iteration counting, and feedback file generation.
 */

import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import {
  SupervisorState,
  type SupervisorConfig,
  type ReviewVerdict,
  type ReviewFinding,
  buildReviewPrompt,
  parseReviewVerdict,
  buildFeedbackContent,
  createSupervisorStateMachine,
  type StateMachine,
} from "../mind-supervisor.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<SupervisorConfig>): SupervisorConfig {
  return {
    mindName: "transport",
    ticketId: "BRE-500",
    waveId: "wave-1",
    tasks: [
      { id: "T001", mind: "transport", description: "Implement SSE endpoint", parallel: false },
      { id: "T002", mind: "transport", description: "Add reconnection logic", parallel: false },
    ],
    repoRoot: "/tmp/test-repo",
    busUrl: "http://localhost:7777",
    busPort: 7777,
    channel: "minds-BRE-500",
    worktreePath: "/tmp/test-worktree",
    baseBranch: "dev",
    callerPane: "%0",
    mindsSourceDir: "/tmp/test-repo/minds",
    featureDir: "/tmp/test-repo/specs/BRE-500-feature",
    dependencies: [],
    maxIterations: 3,
    droneTimeoutMs: 20 * 60 * 1000,
    ...overrides,
  };
}

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

const sampleTestFailureOutput = `bun test v1.2.3

minds/transport/sse.test.ts:
(fail) SSE handler > returns streaming response [2.31ms]
  Expected: 200
  Received: 500

 0 pass
 1 fail
 1 expect() calls
Ran 1 tests across 1 files. [0.45s]`;

const sampleStandards = `## Review Checklist
- [ ] All tasks completed
- [ ] No files modified outside owns_files
- [ ] All new exported functions have tests
- [ ] All tests pass`;

// ---------------------------------------------------------------------------
// State Machine Tests
// ---------------------------------------------------------------------------

describe("SupervisorStateMachine", () => {
  test("initial state is INIT", () => {
    const config = makeConfig();
    const sm = createSupervisorStateMachine(config);
    expect(sm.getState()).toBe(SupervisorState.INIT);
  });

  test("valid transitions from INIT to DRONE_RUNNING", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    expect(sm.getState()).toBe(SupervisorState.DRONE_RUNNING);
  });

  test("valid transitions from DRONE_RUNNING to CHECKING", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    expect(sm.getState()).toBe(SupervisorState.CHECKING);
  });

  test("valid transitions from CHECKING to REVIEWING", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    expect(sm.getState()).toBe(SupervisorState.REVIEWING);
  });

  test("valid transitions from REVIEWING to DONE (approved)", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DONE);
    expect(sm.getState()).toBe(SupervisorState.DONE);
  });

  test("valid transitions from REVIEWING back to DRONE_RUNNING (rejected)", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DRONE_RUNNING); // rejected: re-launch drone
    expect(sm.getState()).toBe(SupervisorState.DRONE_RUNNING);
  });

  test("invalid transition from INIT to REVIEWING throws", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    expect(() => sm.transition(SupervisorState.REVIEWING)).toThrow(
      /Invalid transition/
    );
  });

  test("invalid transition from INIT to DONE throws", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    expect(() => sm.transition(SupervisorState.DONE)).toThrow(
      /Invalid transition/
    );
  });

  test("invalid transition from DONE to any state throws", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DONE);
    expect(() => sm.transition(SupervisorState.INIT)).toThrow(
      /Invalid transition/
    );
  });

  test("getIteration starts at 0", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    expect(sm.getIteration()).toBe(0);
  });

  test("incrementIteration advances and returns current count", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    expect(sm.incrementIteration()).toBe(1);
    expect(sm.incrementIteration()).toBe(2);
    expect(sm.getIteration()).toBe(2);
  });

  test("isMaxIterations returns true when limit reached", () => {
    const sm = createSupervisorStateMachine(makeConfig({ maxIterations: 2 }));
    sm.incrementIteration();
    sm.incrementIteration();
    expect(sm.isMaxIterations()).toBe(true);
  });

  test("isMaxIterations returns false below limit", () => {
    const sm = createSupervisorStateMachine(makeConfig({ maxIterations: 3 }));
    sm.incrementIteration();
    expect(sm.isMaxIterations()).toBe(false);
  });

  test("INIT can transition to FAILED", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.FAILED);
    expect(sm.getState()).toBe(SupervisorState.FAILED);
  });

  test("DRONE_RUNNING can transition to FAILED", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.transition(SupervisorState.FAILED);
    expect(sm.getState()).toBe(SupervisorState.FAILED);
  });
});

// ---------------------------------------------------------------------------
// Review Prompt Construction
// ---------------------------------------------------------------------------

describe("buildReviewPrompt", () => {
  test("includes diff in prompt", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: makeConfig().tasks,
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
      tasks: makeConfig().tasks,
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
      tasks: makeConfig().tasks,
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
      tasks: makeConfig().tasks,
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
      tasks: makeConfig().tasks,
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
      tasks: makeConfig().tasks,
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
      tasks: makeConfig().tasks,
      iteration: 1,
    });
    // Should not exceed ~50k chars for the diff portion
    expect(prompt.length).toBeLessThan(200_000);
    expect(prompt).toContain("[truncated");
  });
});

// ---------------------------------------------------------------------------
// Verdict Parsing
// ---------------------------------------------------------------------------

describe("parseReviewVerdict", () => {
  test("parses approved verdict", () => {
    const raw = JSON.stringify({
      approved: true,
      findings: [],
    });
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

// ---------------------------------------------------------------------------
// Full cycle simulation (state machine + iteration counting)
// ---------------------------------------------------------------------------

describe("Full review cycle simulation", () => {
  test("approve on first try: INIT -> DRONE_RUNNING -> CHECKING -> REVIEWING -> DONE", () => {
    const sm = createSupervisorStateMachine(makeConfig());

    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    expect(sm.getIteration()).toBe(1);

    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);

    // Simulate approved verdict
    sm.transition(SupervisorState.DONE);
    expect(sm.getState()).toBe(SupervisorState.DONE);
    expect(sm.getIteration()).toBe(1);
  });

  test("reject then approve: 2 iterations", () => {
    const sm = createSupervisorStateMachine(makeConfig({ maxIterations: 3 }));

    // Iteration 1
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);

    // Rejected -> back to DRONE_RUNNING
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    expect(sm.getIteration()).toBe(2);
    expect(sm.isMaxIterations()).toBe(false);

    // Iteration 2
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DONE);
    expect(sm.getState()).toBe(SupervisorState.DONE);
  });

  test("max iterations reached forces DONE", () => {
    const sm = createSupervisorStateMachine(makeConfig({ maxIterations: 2 }));

    // Iteration 1
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);

    // Rejected
    sm.transition(SupervisorState.DRONE_RUNNING);
    sm.incrementIteration();
    expect(sm.isMaxIterations()).toBe(true);

    // At max iterations, even if rejected, should go to DONE
    sm.transition(SupervisorState.CHECKING);
    sm.transition(SupervisorState.REVIEWING);
    sm.transition(SupervisorState.DONE); // forced approval with warnings
    expect(sm.getState()).toBe(SupervisorState.DONE);
    expect(sm.getIteration()).toBe(2);
  });
});
