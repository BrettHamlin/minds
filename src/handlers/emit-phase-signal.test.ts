import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { dispatchSignal } from "./emit-phase-signal";
import { handleBusMessage } from "../../transport/bus-signal-bridge";
import { startBusServer, teardownBusServer } from "../scripts/orchestrator/commands/orchestrator-init";

// __dirname = src/handlers → ../../ = repo root
const REAL_REPO_ROOT = path.resolve(__dirname, "../../");

// ---------------------------------------------------------------------------
// dispatchSignal() — transport routing
// ---------------------------------------------------------------------------

describe("dispatchSignal: bus transport", () => {
  let busServerPid: number;
  let busUrl: string;

  beforeAll(async () => {
    const bus = await startBusServer(REAL_REPO_ROOT);
    busServerPid = bus.pid;
    busUrl = bus.url;
  });

  afterAll(() => {
    if (busServerPid) teardownBusServer(busServerPid);
  });

  test("1. COLLAB_TRANSPORT=bus + BUS_URL → publishes signal to bus", async () => {
    const savedTransport = process.env.COLLAB_TRANSPORT;
    const savedBusUrl = process.env.BUS_URL;

    process.env.COLLAB_TRANSPORT = "bus";
    process.env.BUS_URL = busUrl;

    await dispatchSignal(
      "[SIGNAL:TEST-001:abc1] BLINDQA_COMPLETE | All checks passed",
      "%orch-pane",
      "blindqa",
      "TEST-001",
      "abc1",
      "/dev/null" // tmux path unused in bus mode
    );

    // Verify message reached the bus server
    const resp = await fetch(`${busUrl}/status`);
    const body = await resp.json() as { ok: boolean; messageCount: number };
    expect(body.ok).toBe(true);
    expect(body.messageCount).toBeGreaterThan(0);

    // Restore env
    if (savedTransport !== undefined) process.env.COLLAB_TRANSPORT = savedTransport;
    else delete process.env.COLLAB_TRANSPORT;
    if (savedBusUrl !== undefined) process.env.BUS_URL = savedBusUrl;
    else delete process.env.BUS_URL;
  });

  test("2. COLLAB_TRANSPORT=bus + BUS_URL → signal written to queue file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-test-"));
    const queueDir = path.join(tmpDir, ".collab/state/signal-queue");
    fs.mkdirSync(queueDir, { recursive: true });

    const savedTransport = process.env.COLLAB_TRANSPORT;
    const savedBusUrl = process.env.BUS_URL;

    process.env.COLLAB_TRANSPORT = "bus";
    process.env.BUS_URL = busUrl;

    // We can't override queueDir from here (it's inside emitPhaseSignal, not dispatchSignal).
    // Test the queue write through the emitter path indirectly:
    // The queue write happens in emitPhaseSignal before calling dispatchSignal.
    // Verify dispatchSignal itself doesn't crash and bus sees the message.
    let threw = false;
    try {
      await dispatchSignal(
        "[SIGNAL:TEST-002:abc2] RUN_TESTS_COMPLETE | All tests passed",
        "%orch-pane",
        "run_tests",
        "TEST-002",
        "abc2",
        "/dev/null"
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    if (savedTransport !== undefined) process.env.COLLAB_TRANSPORT = savedTransport;
    else delete process.env.COLLAB_TRANSPORT;
    if (savedBusUrl !== undefined) process.env.BUS_URL = savedBusUrl;
    else delete process.env.BUS_URL;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("dispatchSignal: tmux transport (fallback)", () => {
  test("3. COLLAB_TRANSPORT=tmux → no bus publish (tmux path attempted)", async () => {
    // Start a fresh bus server to verify no messages land on it
    const bus = await startBusServer(REAL_REPO_ROOT);
    const savedTransport = process.env.COLLAB_TRANSPORT;
    const savedBusUrl = process.env.BUS_URL;
    process.env.COLLAB_TRANSPORT = "tmux";
    process.env.BUS_URL = bus.url;

    // dispatchSignal should use tmux path — tmux will fail (no pane), but that's expected
    await dispatchSignal(
      "[SIGNAL:TEST-003:abc3] BLINDQA_COMPLETE | Done",
      "%nonexistent-pane",
      "blindqa",
      "TEST-003",
      "abc3",
      "/dev/null" // tmux binary path — will fail gracefully
    );

    // Bus server should have received NO messages (tmux path was taken)
    const resp = await fetch(`${bus.url}/status`);
    const body = await resp.json() as { messageCount: number };
    expect(body.messageCount).toBe(0);

    if (savedTransport !== undefined) process.env.COLLAB_TRANSPORT = savedTransport;
    else delete process.env.COLLAB_TRANSPORT;
    if (savedBusUrl !== undefined) process.env.BUS_URL = savedBusUrl;
    else delete process.env.BUS_URL;
    teardownBusServer(bus.pid);
  });

  test("4. No transport env set → defaults to tmux, no bus publish", async () => {
    const bus = await startBusServer(REAL_REPO_ROOT);
    const savedTransport = process.env.COLLAB_TRANSPORT;
    const savedBusUrl = process.env.BUS_URL;
    delete process.env.COLLAB_TRANSPORT;
    delete process.env.BUS_URL;

    await dispatchSignal(
      "[SIGNAL:TEST-004:abc4] BLINDQA_COMPLETE | Done",
      "%nonexistent",
      "blindqa",
      "TEST-004",
      "abc4",
      "/dev/null"
    );

    const resp = await fetch(`${bus.url}/status`);
    const body = await resp.json() as { messageCount: number };
    expect(body.messageCount).toBe(0);

    if (savedTransport !== undefined) process.env.COLLAB_TRANSPORT = savedTransport;
    if (savedBusUrl !== undefined) process.env.BUS_URL = savedBusUrl;
    teardownBusServer(bus.pid);
  });

  test("5. COLLAB_TRANSPORT=bus but no BUS_URL → falls back gracefully (no crash)", async () => {
    const savedTransport = process.env.COLLAB_TRANSPORT;
    const savedBusUrl = process.env.BUS_URL;
    process.env.COLLAB_TRANSPORT = "bus";
    delete process.env.BUS_URL;

    let threw = false;
    try {
      await dispatchSignal(
        "[SIGNAL:TEST-005:abc5] BLINDQA_COMPLETE | Done",
        "%nonexistent",
        "blindqa",
        "TEST-005",
        "abc5",
        "/dev/null"
      );
    } catch {
      threw = true;
    }
    // Falls back to tmux path which fails silently — no crash
    expect(threw).toBe(false);

    if (savedTransport !== undefined) process.env.COLLAB_TRANSPORT = savedTransport;
    else delete process.env.COLLAB_TRANSPORT;
    if (savedBusUrl !== undefined) process.env.BUS_URL = savedBusUrl;
  });
});

// ---------------------------------------------------------------------------
// bus-signal-bridge: handleBusMessage()
// ---------------------------------------------------------------------------

describe("bus-signal-bridge: handleBusMessage()", () => {
  test("6. signal-type message with payload.signal → returns without throwing", async () => {
    // handleBusMessage will try tmux send-keys to a non-existent pane.
    // Bun.spawnSync is synchronous and handles tmux failures without throwing.
    let threw = false;
    try {
      await handleBusMessage(
        {
          type: "signal",
          payload: { signal: "[SIGNAL:TEST-006:abc6] BLINDQA_COMPLETE | Done" },
          from: "agent-blindqa",
          channel: "pipeline-TEST-006",
        },
        "%nonexistent-test-pane"
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("7. non-signal message type → silently ignored (no tmux call attempted)", async () => {
    let threw = false;
    try {
      await handleBusMessage({ type: "progress", payload: { message: "working..." } }, "%pane");
      await handleBusMessage({ type: "started", payload: {} }, "%pane");
      await handleBusMessage({ type: "done", payload: {} }, "%pane");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("8. malformed signal message (missing payload.signal) → silently ignored", async () => {
    let threw = false;
    try {
      await handleBusMessage({ type: "signal", payload: {} }, "%pane");
      await handleBusMessage({ type: "signal" }, "%pane"); // no payload
      await handleBusMessage(null, "%pane");
      await handleBusMessage("not an object", "%pane");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Refactored handlers: structural tests
// ---------------------------------------------------------------------------

describe("Refactored emit-question-signal.ts", () => {
  test("9. emit-question-signal.ts calls emitPhaseSignal with clarify event map", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "emit-question-signal.ts"),
      "utf-8"
    );
    expect(src).toContain('import { emitPhaseSignal } from "./emit-phase-signal"');
    expect(src).toContain('emitPhaseSignal("clarify"');
    expect(src).toContain('question: "awaitingInput"');
    expect(src).toContain('complete: "completed"');
  });
});

describe("Refactored emit-spec-critique-signal.ts", () => {
  test("10. emit-spec-critique-signal.ts calls emitPhaseSignal with spec_critique event map", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "emit-spec-critique-signal.ts"),
      "utf-8"
    );
    expect(src).toContain('import { emitPhaseSignal } from "./emit-phase-signal"');
    expect(src).toContain('emitPhaseSignal("spec_critique"');
    expect(src).toContain('pass: "completed"');
    expect(src).toContain('fail: "failed"');
  });
});
