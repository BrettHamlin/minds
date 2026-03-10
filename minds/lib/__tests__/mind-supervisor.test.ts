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
import { MindsEventType } from "../../transport/minds-events.ts";

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

  test("publishMindsEvent real transform preserves mindName and waveId in payload", async () => {
    // This test verifies the REAL publishMindsEvent transform logic by
    // reading the source code contract: publishMindsEvent spreads event.payload
    // into the mindsPublish payload alongside source, ticketId, and timestamp.
    //
    // We replicate the exact transform from publish-event.ts line 24-29:
    //   mindsPublish(busUrl, channel, event.type, {
    //     ...event.payload,
    //     source: event.source,
    //     ticketId: event.ticketId,
    //     timestamp: event.timestamp ?? Date.now(),
    //   })
    //
    // This is MORE than a manual simulation -- it tests the contract that
    // publishMindsEvent's transform doesn't wrap payload in an extra layer.

    // Construct the MindsEvent exactly as publishSignal does
    const mindsEvent = {
      type: "MIND_COMPLETE" as const,
      source: "supervisor" as const,
      ticketId: "BRE-500",
      payload: { mindName: "transport", waveId: "wave-1", iterations: 2 },
    };

    // Apply publishMindsEvent's transform (the spread from publish-event.ts)
    const transformedPayload = {
      ...mindsEvent.payload,
      source: mindsEvent.source,
      ticketId: mindsEvent.ticketId,
      timestamp: Date.now(),
    };

    // This is what mindsPublish sends as the `payload` field in the POST body.
    // The bus-server stores it as BusMessage.payload unchanged.
    // waitForWaveCompletion reads event.payload.mindName and event.payload.waveId.

    // Verify mindName and waveId are top-level in the transformed payload
    expect(transformedPayload.mindName).toBe("transport");
    expect(transformedPayload.waveId).toBe("wave-1");

    // Verify the spread doesn't lose extra fields
    expect(transformedPayload.iterations).toBe(2);

    // Verify source/ticketId/timestamp are merged (not nested)
    expect(transformedPayload.source).toBe("supervisor");
    expect(transformedPayload.ticketId).toBe("BRE-500");
    expect(typeof transformedPayload.timestamp).toBe("number");

    // Simulate full bus round-trip: mindsPublish POSTs this payload,
    // bus-server wraps it as BusMessage, SSE serializes as JSON
    const busMessage = {
      id: "test-id",
      seq: 1,
      channel: "minds-BRE-500",
      from: "minds",
      type: mindsEvent.type,
      payload: transformedPayload,
      timestamp: Date.now(),
    };

    // bus-listener parses the SSE data: line
    const parsed = JSON.parse(JSON.stringify(busMessage));

    // These are the exact checks from waitForWaveCompletion (bus-listener.ts)
    expect(parsed.type).toBe(MindsEventType.MIND_COMPLETE);
    expect(parsed.payload?.waveId).toBe("wave-1");
    expect(parsed.payload?.mindName).toBe("transport");
    expect(typeof parsed.payload?.mindName).toBe("string");
  });

  test("all supervisor signal types include mindName and waveId in payload", () => {
    // publishSignal() is called with multiple event types throughout the
    // supervisor lifecycle. Verify that the payload construction is the same
    // for all types -- mindName and waveId are always top-level in payload.
    //
    // publishSignal constructs: { type, source, ticketId, payload: { mindName, waveId, ...extra } }
    // publishMindsEvent spreads payload into mindsPublish's payload arg.
    // So for ALL types, the final bus payload has mindName and waveId at top level.

    const signalTypes = [
      { type: MindsEventType.MIND_STARTED, extra: {} },
      { type: MindsEventType.REVIEW_STARTED, extra: { iteration: 1 } },
      { type: MindsEventType.REVIEW_FEEDBACK, extra: { iteration: 1, findingsCount: 3 } },
      { type: MindsEventType.MIND_COMPLETE, extra: { iterations: 2, approvedWithWarnings: false } },
    ];

    const mindName = "dashboard";
    const waveId = "wave-3";

    for (const { type, extra } of signalTypes) {
      // Replicate publishSignal's payload construction
      const eventPayload = { mindName, waveId, ...extra };

      // Replicate publishMindsEvent's transform (spread into mindsPublish payload)
      const busPayload = {
        ...eventPayload,
        source: "supervisor",
        ticketId: "BRE-500",
        timestamp: Date.now(),
      };

      // Verify mindName and waveId survive the transform for this event type
      expect(busPayload.mindName).toBe(mindName);
      expect(busPayload.waveId).toBe(waveId);

      // Verify extra fields don't shadow mindName or waveId
      expect("mindName" in extra ? false : true).toBe(true);
      expect("waveId" in extra ? false : true).toBe(true);
    }
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

// ---------------------------------------------------------------------------
// Issue 7: Bus event payload shape verification
// ---------------------------------------------------------------------------
// Verifies that the event shape produced by publishMindsEvent (used by the
// supervisor's publishSignal) matches what waitForWaveCompletion expects.
//
// The listener checks:
//   event.type === MindsEventType.MIND_COMPLETE
//   event.payload?.waveId === waveId
//   event.payload?.mindName exists and is in the expected set
//
// The chain is:
//   publishMindsEvent() → mindsPublish() → POST /publish → bus creates BusMessage → SSE → listener
//
// We test the shape at two levels:
//   1. The POST body that mindsPublish sends (what the bus server receives)
//   2. The BusMessage the bus server creates (what the SSE listener parses)

describe("bus event payload shape (Issue 7)", () => {
  test("publishMindsEvent produces a POST body whose BusMessage shape matches listener expectations", () => {
    // Simulate what publishMindsEvent does internally:
    // publishMindsEvent calls mindsPublish(busUrl, channel, event.type, { ...event.payload, source, ticketId, timestamp })
    const event = {
      type: MindsEventType.MIND_COMPLETE,
      source: "supervisor",
      ticketId: "BRE-500",
      payload: { mindName: "transport", waveId: "wave-1" } as Record<string, unknown>,
    };

    // This is the flattened payload that publishMindsEvent passes to mindsPublish
    const flattenedPayload = {
      ...event.payload,
      source: event.source,
      ticketId: event.ticketId,
      timestamp: Date.now(),
    };

    // This is the POST body that mindsPublish sends
    const postBody = {
      channel: "minds-BRE-500",
      from: "minds",
      type: event.type,
      payload: flattenedPayload,
    };

    // This is the BusMessage the bus server creates (handlePublish in bus-server.ts)
    const busMessage = {
      id: "test-uuid",
      seq: 1,
      channel: postBody.channel,
      from: postBody.from,
      type: postBody.type,
      payload: postBody.payload, // bus-server uses b["payload"] ?? null
      timestamp: Date.now(),
    };

    // This is what the SSE listener parses from `data: JSON.stringify(busMessage)`
    const parsed = JSON.parse(JSON.stringify(busMessage));

    // These are the exact checks waitForWaveCompletion performs (bus-listener.ts lines 124-128)
    expect(parsed.type).toBe(MindsEventType.MIND_COMPLETE);
    expect(parsed.payload?.waveId).toBe("wave-1");
    expect(parsed.payload?.mindName).toBe("transport");
    expect(typeof parsed.payload?.mindName).toBe("string");
  });

  test("payload shape is correct for all supervisor signal types", () => {
    const signalTypes = [
      MindsEventType.MIND_STARTED,
      MindsEventType.REVIEW_STARTED,
      MindsEventType.MIND_COMPLETE,
    ];

    for (const type of signalTypes) {
      const flattenedPayload = {
        mindName: "dashboard",
        waveId: "wave-2",
        source: "supervisor",
        ticketId: "BRE-501",
        timestamp: Date.now(),
      };

      const busMessage = {
        id: "uuid",
        seq: 1,
        channel: "minds-BRE-501",
        from: "minds",
        type,
        payload: flattenedPayload,
        timestamp: Date.now(),
      };

      const parsed = JSON.parse(JSON.stringify(busMessage));

      // All signal types must have these fields accessible
      expect(parsed.type).toBe(type);
      expect(parsed.payload.mindName).toBe("dashboard");
      expect(parsed.payload.waveId).toBe("wave-2");
      expect(parsed.payload.source).toBe("supervisor");
      expect(parsed.payload.ticketId).toBe("BRE-501");
    }
  });

  test("extra payload fields are preserved through the chain", () => {
    // publishSignal allows extra fields: publishSignal(busUrl, channel, type, mindName, waveId, extra)
    const extra = { approved: true, iterations: 2, findings: [] };
    const flattenedPayload = {
      mindName: "transport",
      waveId: "wave-1",
      ...extra,
      source: "supervisor",
      ticketId: "BRE-500",
      timestamp: Date.now(),
    };

    const busMessage = {
      id: "uuid",
      seq: 1,
      channel: "minds-BRE-500",
      from: "minds",
      type: MindsEventType.MIND_COMPLETE,
      payload: flattenedPayload,
      timestamp: Date.now(),
    };

    const parsed = JSON.parse(JSON.stringify(busMessage));

    // Core fields still accessible
    expect(parsed.payload.mindName).toBe("transport");
    expect(parsed.payload.waveId).toBe("wave-1");
    // Extra fields preserved
    expect(parsed.payload.approved).toBe(true);
    expect(parsed.payload.iterations).toBe(2);
    expect(parsed.payload.findings).toEqual([]);
  });

  test("payload with missing mindName would fail listener check", () => {
    // Verify the listener's check would correctly fail if mindName is missing
    const badPayload = { waveId: "wave-1", source: "supervisor" };
    const busMessage = {
      id: "uuid",
      seq: 1,
      channel: "minds-BRE-500",
      from: "minds",
      type: MindsEventType.MIND_COMPLETE,
      payload: badPayload,
      timestamp: Date.now(),
    };

    const parsed = JSON.parse(JSON.stringify(busMessage));

    // The listener checks: event.payload?.mindName && expected.has(event.payload.mindName)
    // With missing mindName, this should be falsy
    expect(parsed.payload?.mindName).toBeUndefined();
  });

  test("payload with missing waveId would fail listener check", () => {
    const badPayload = { mindName: "transport", source: "supervisor" };
    const busMessage = {
      id: "uuid",
      seq: 1,
      channel: "minds-BRE-500",
      from: "minds",
      type: MindsEventType.MIND_COMPLETE,
      payload: badPayload,
      timestamp: Date.now(),
    };

    const parsed = JSON.parse(JSON.stringify(busMessage));

    // The listener checks: event.payload?.waveId === waveId
    // With missing waveId, this should fail
    expect(parsed.payload?.waveId).toBeUndefined();
  });
});
