import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as path from "path";
import { handleCommandMessage } from "./bus-command-bridge";
import { startBusServer, teardownBusServer } from "./test-helpers";

// __dirname = minds/transport/ → ../.. = repo root
const REAL_REPO_ROOT = path.resolve(__dirname, "../../");

// ---------------------------------------------------------------------------
// handleCommandMessage — command delivery and ack
// ---------------------------------------------------------------------------

describe("bus-command-bridge: handleCommandMessage()", () => {
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

  test("1. command message → tmux send-keys invoked (no crash) + ack published", async () => {
    // handleCommandMessage calls Bun.spawnSync for tmux (will fail silently — no real pane)
    // and publishes command_received ack to the bus
    let threw = false;
    try {
      await handleCommandMessage(
        {
          type: "command",
          payload: { command: "/collab.clarify", phase: "clarify", agent_pane: "%nonexistent" },
          from: "orchestrator",
          channel: "pipeline-TEST-380",
        },
        "%nonexistent-pane",
        busUrl,
        "pipeline-TEST-380"
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    // Verify the command_received ack was published to bus
    const resp = await fetch(`${busUrl}/status`);
    const body = await resp.json() as { ok: boolean; messageCount: number };
    expect(body.ok).toBe(true);
    expect(body.messageCount).toBeGreaterThan(0);
  });

  test("2. command message with missing payload.command → silently ignored", async () => {
    let threw = false;
    try {
      await handleCommandMessage(
        { type: "command", payload: {}, from: "orchestrator", channel: "pipeline-TEST-380" },
        "%nonexistent-pane",
        busUrl,
        "pipeline-TEST-380"
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("3. non-command/non-question message → silently ignored (no tmux call)", async () => {
    // Start a fresh bus to verify no ack is published for ignored messages
    const bus2 = await startBusServer(REAL_REPO_ROOT);
    let threw = false;
    try {
      await handleCommandMessage(
        { type: "progress", payload: { message: "working..." }, from: "agent" },
        "%nonexistent-pane",
        bus2.url,
        "pipeline-TEST-380"
      );
      await handleCommandMessage(
        { type: "started", payload: {} },
        "%nonexistent-pane",
        bus2.url,
        "pipeline-TEST-380"
      );
      await handleCommandMessage(
        { type: "signal", payload: { signal: "[SIGNAL:X:Y] CLARIFY_COMPLETE | done" } },
        "%nonexistent-pane",
        bus2.url,
        "pipeline-TEST-380"
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    // No ack published for non-command messages
    const resp = await fetch(`${bus2.url}/status`);
    const body = await resp.json() as { messageCount: number };
    expect(body.messageCount).toBe(0);
    teardownBusServer(bus2.pid);
  });

  test("4. question_response message → tmux Down/Enter invoked (no crash)", async () => {
    let threw = false;
    try {
      await handleCommandMessage(
        {
          type: "question_response",
          payload: { steps: 2 },
          from: "orchestrator",
          channel: "pipeline-TEST-380",
        },
        "%nonexistent-pane",
        busUrl,
        "pipeline-TEST-380"
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("5. malformed message (null, string, no type) → silently ignored", async () => {
    let threw = false;
    try {
      await handleCommandMessage(null, "%nonexistent-pane", busUrl, "pipeline-TEST-380");
      await handleCommandMessage("not an object", "%nonexistent-pane", busUrl, "pipeline-TEST-380");
      await handleCommandMessage({ payload: { command: "/cmd" } }, "%nonexistent-pane", busUrl, "pipeline-TEST-380"); // no type
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
