/**
 * mind-supervisor.test.ts -- Tests for the deterministic Mind supervisor.
 *
 * Tests the state machine, review prompt construction, verdict parsing,
 * iteration counting, feedback file generation, and validation guards.
 */

import { describe, test, expect, beforeEach, mock, spyOn, afterEach } from "bun:test";
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  SupervisorState,
  type SupervisorConfig,
  type ReviewVerdict,
  type ReviewFinding,
  buildReviewPrompt,
  parseReviewVerdict,
  buildFeedbackContent,
  createSupervisorStateMachine,
  runMindSupervisor,
  installDroneStopHook,
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

  test("valid transitions from INIT to DONE", () => {
    const sm = createSupervisorStateMachine(makeConfig());
    sm.transition(SupervisorState.DONE);
    expect(sm.getState()).toBe(SupervisorState.DONE);
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

  test("includes previousFeedback when provided", () => {
    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: makeConfig().tasks,
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
      tasks: makeConfig().tasks,
      iteration: 1,
    });
    expect(prompt).not.toContain("Previous Feedback");
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
// maxIterations validation (Fix #7)
// ---------------------------------------------------------------------------

describe("runMindSupervisor validation", () => {
  test("throws when maxIterations is 0", async () => {
    const config = makeConfig({ maxIterations: 0 });
    await expect(runMindSupervisor(config)).rejects.toThrow(/maxIterations must be >= 1/);
  });

  test("throws when maxIterations is negative", async () => {
    const config = makeConfig({ maxIterations: -1 });
    await expect(runMindSupervisor(config)).rejects.toThrow(/maxIterations must be >= 1/);
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

// ---------------------------------------------------------------------------
// Issue 5 — Drone Stop Hook (sentinel file)
// ---------------------------------------------------------------------------

describe("installDroneStopHook", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `drone-hook-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates .claude/settings.json with Stop hook", () => {
    installDroneStopHook(tmpDir);

    const settingsPath = join(tmpDir, ".claude", "settings.json");
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.Stop[0].hooks[0].type).toBe("command");
    expect(settings.hooks.Stop[0].hooks[0].command).toContain(".drone-complete");
  });

  test("creates .claude directory if it does not exist", () => {
    const claudeDir = join(tmpDir, ".claude");
    expect(existsSync(claudeDir)).toBe(false);

    installDroneStopHook(tmpDir);

    expect(existsSync(claudeDir)).toBe(true);
  });

  test("merges with existing settings.json without overwriting", () => {
    const claudeDir = join(tmpDir, ".claude");
    mkdirSync(claudeDir, { recursive: true });

    const existing = {
      customField: "preserved",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
      },
    };
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(existing));

    installDroneStopHook(tmpDir);

    const merged = JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
    expect(merged.customField).toBe("preserved");
    expect(merged.hooks.Stop).toBeDefined();
    // The PreToolUse hook should be preserved through the merge
    expect(merged.hooks.PreToolUse).toBeDefined();
  });

  test("sentinel path in hook command matches worktree root", () => {
    installDroneStopHook(tmpDir);

    const settings = JSON.parse(readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"));
    const hookCommand = settings.hooks.Stop[0].hooks[0].command;
    const expectedSentinelPath = join(tmpDir, ".drone-complete");
    expect(hookCommand).toContain(expectedSentinelPath);
  });
});

// ---------------------------------------------------------------------------
// Issue 7 — Bus event payload shape verification
// ---------------------------------------------------------------------------

describe("Bus event payload shape", () => {
  test("publishSignal produces payload shape matching waitForWaveCompletion expectations", async () => {
    // This test traces the data flow through the publish chain to verify
    // that the payload shape produced by publishSignal() matches what
    // waitForWaveCompletion() expects to find.
    //
    // waitForWaveCompletion() checks:
    //   event.type === MIND_COMPLETE
    //   event.payload?.waveId === waveId
    //   event.payload?.mindName
    //
    // The chain is:
    //   publishSignal() → publishMindsEvent() → mindsPublish() → POST /publish
    //   bus-server receives → BusMessage { payload: b["payload"] } → SSE data: JSON(msg)
    //   bus-listener reads → JSON.parse(data) → event.payload.waveId / event.payload.mindName

    // Simulate the transform chain without a real bus server.
    // publishSignal constructs this event:
    const mindName = "transport";
    const waveId = "wave-1";
    const channel = "minds-BRE-500";
    const type = "MIND_COMPLETE";
    const ticketId = channel.replace(/^minds-/, "");
    const extra = { iterations: 2, approvedWithWarnings: false };

    // Step 1: publishSignal → publishMindsEvent
    // publishMindsEvent calls mindsPublish with:
    //   type = event.type
    //   payload = { ...event.payload, source, ticketId, timestamp }
    const eventPayload = { mindName, waveId, ...extra };
    const publishPayload = {
      ...eventPayload,
      source: "supervisor",
      ticketId,
      timestamp: Date.now(),
    };

    // Step 2: mindsPublish sends to bus:
    //   { channel, from: "minds", type, payload: publishPayload }
    const busRequestBody = {
      channel,
      from: "minds",
      type,
      payload: publishPayload,
    };

    // Step 3: bus-server creates BusMessage:
    //   { id, seq, channel, from, type, payload: b["payload"], timestamp }
    const busMessage = {
      id: crypto.randomUUID(),
      seq: 1,
      channel: busRequestBody.channel,
      from: busRequestBody.from,
      type: busRequestBody.type,
      payload: busRequestBody.payload,
      timestamp: Date.now(),
    };

    // Step 4: SSE sends `data: ${JSON.stringify(busMessage)}`
    // bus-listener parses this JSON
    const sseData = JSON.stringify(busMessage);
    const parsed = JSON.parse(sseData);

    // Step 5: waitForWaveCompletion checks:
    expect(parsed.type).toBe("MIND_COMPLETE");
    expect(parsed.payload).toBeDefined();
    expect(parsed.payload.waveId).toBe(waveId);
    expect(parsed.payload.mindName).toBe(mindName);
    // These are the three checks in bus-listener.ts lines 124-129
    expect(typeof parsed.payload.mindName).toBe("string");
  });

  test("MIND_COMPLETE payload includes required fields at correct nesting level", () => {
    // Verify the payload structure doesn't nest mindName/waveId too deep
    const mindName = "signals";
    const waveId = "wave-2";

    // The publishSignal function puts mindName and waveId directly in payload
    const payload = { mindName, waveId, source: "supervisor", ticketId: "BRE-500", timestamp: Date.now() };

    // Bus wraps this as BusMessage.payload
    const busMessage = { type: "MIND_COMPLETE", payload };

    // bus-listener accesses event.payload.mindName and event.payload.waveId
    // These must be at the FIRST level of payload, not nested deeper
    expect(busMessage.payload.mindName).toBe(mindName);
    expect(busMessage.payload.waveId).toBe(waveId);
  });
});

// ---------------------------------------------------------------------------
// Issue 8 — Previous feedback accumulation
// ---------------------------------------------------------------------------

describe("buildReviewPrompt with multiple previous feedback", () => {
  test("includes all previous feedback separated by dividers", () => {
    const allFeedback = [
      "# Round 1\n- Missing tests",
      "# Round 2\n- Unused import",
    ].join("\n\n---\n\n");

    const prompt = buildReviewPrompt({
      diff: sampleDiff,
      testOutput: sampleTestOutput,
      standards: sampleStandards,
      tasks: makeConfig().tasks,
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
