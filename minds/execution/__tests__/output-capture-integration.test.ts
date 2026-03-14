/**
 * output-capture-integration.test.ts -- BRE-579: Output capture via Axon events
 *
 * Tests that phase-dispatch's dispatchToAgent correctly uses TerminalMultiplexer
 * for output capture when an axon transport (or any multiplexer) is provided,
 * rather than being hardcoded to TmuxClient.
 *
 * Covers:
 * - capturePane returns process output for receipt verification
 * - capturePane on dead/completed process returns buffered output
 * - Multiple capturePane calls return updated content
 * - Fallback to tmux when no multiplexer provided
 */

import { describe, test, expect } from "bun:test";
import type { TerminalMultiplexer } from "../../lib/terminal-multiplexer.ts";
import {
  dispatchToAgent,
  type TransportOpts,
} from "../phase-dispatch.ts";

// ---------------------------------------------------------------------------
// Fast poll opts for tests (10ms interval, 2 attempts = 20ms max wait)
// ---------------------------------------------------------------------------
const FAST_POLL: Pick<TransportOpts, "receiptPollIntervalMs" | "receiptPollAttempts"> = {
  receiptPollIntervalMs: 10,
  receiptPollAttempts: 2,
};

// ---------------------------------------------------------------------------
// Mock multiplexer for testing output capture
// ---------------------------------------------------------------------------

class MockMultiplexer implements TerminalMultiplexer {
  public captures: Map<string, string[]> = new Map();
  public captureCallCount = 0;
  public sentCommands: Array<{ paneId: string; command: string }> = [];
  public killedPanes: string[] = [];

  constructor(captureResponses?: Map<string, string[]>) {
    if (captureResponses) {
      this.captures = captureResponses;
    }
  }

  async splitPane(_sourcePane: string): Promise<string> {
    return "mock-pane-0";
  }

  async sendKeys(paneId: string, command: string): Promise<void> {
    this.sentCommands.push({ paneId, command });
  }

  async killPane(paneId: string): Promise<void> {
    this.killedPanes.push(paneId);
  }

  async isPaneAlive(_paneId: string): Promise<boolean> {
    return true;
  }

  async getCurrentPane(): Promise<string> {
    return "mock-current";
  }

  async capturePane(paneId: string): Promise<string> {
    this.captureCallCount++;
    const responses = this.captures.get(paneId) ?? [""];
    // Return responses in order; if exhausted, return the last one
    const idx = Math.min(this.captureCallCount - 1, responses.length - 1);
    return responses[idx];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BRE-579: Output capture integration", () => {
  describe("dispatchToAgent with multiplexer", () => {
    test("uses multiplexer.capturePane for receipt verification when multiplexer provided", async () => {
      // First capture returns "before" state, subsequent captures return changed content
      const captures = new Map<string, string[]>();
      captures.set("axon-pane-1", ["$ ", "$ echo hello\nhello\n$ "]);

      const mux = new MockMultiplexer(captures);
      const result = await dispatchToAgent(
        "axon-pane-1",
        "echo hello",
        1,
        { transport: "axon", ...FAST_POLL },
        mux,
      );

      expect(result.dispatched).toBe(true);
      expect(result.received).toBe(true);
      expect(result.paneId).toBe("axon-pane-1");
      expect(result.command).toBe("echo hello");
      // capturePane was called at least twice (before + at least one poll)
      expect(mux.captureCallCount).toBeGreaterThanOrEqual(2);
    });

    test("detects receipt when pane content changes between captures", async () => {
      const captures = new Map<string, string[]>();
      // First call: empty, second call: has output
      captures.set("pane-receipt", ["", "command output here"]);

      const mux = new MockMultiplexer(captures);
      const result = await dispatchToAgent(
        "pane-receipt",
        "ls -la",
        1,
        { transport: "axon", ...FAST_POLL },
        mux,
      );

      expect(result.received).toBe(true);
    });

    test("reports not received when pane content never changes", async () => {
      const captures = new Map<string, string[]>();
      // Content never changes -- always returns same string
      captures.set("stuck-pane", ["same content"]);

      const mux = new MockMultiplexer(captures);
      const result = await dispatchToAgent(
        "stuck-pane",
        "hanging-command",
        1,
        { transport: "axon", ...FAST_POLL },
        mux,
      );

      expect(result.dispatched).toBe(true);
      expect(result.received).toBe(false);
    });

    test("sendKeys is called on multiplexer when multiplexer provided", async () => {
      const captures = new Map<string, string[]>();
      captures.set("send-pane", ["before", "after"]);

      const mux = new MockMultiplexer(captures);
      await dispatchToAgent(
        "send-pane",
        "my-command --flag",
        1,
        { transport: "axon", ...FAST_POLL },
        mux,
      );

      expect(mux.sentCommands).toHaveLength(1);
      expect(mux.sentCommands[0]).toEqual({
        paneId: "send-pane",
        command: "my-command --flag",
      });
    });

    test("bus transport still bypasses multiplexer", async () => {
      // When transport is "bus", dispatchToAgent should use the bus path
      // and not call capturePane at all, even if a multiplexer is provided
      const mux = new MockMultiplexer();
      const result = await dispatchToAgent(
        "%99",
        "/collab.plan",
        1,
        {
          transport: "bus",
          busUrl: "http://127.0.0.1:1", // unreachable
          ticketId: "TEST-579",
          phase: "plan",
          ...FAST_POLL,
        },
        mux,
      );

      // Bus dispatch attempts to publish (fails due to unreachable URL)
      // but the multiplexer capturePane should NOT be called
      expect(mux.captureCallCount).toBe(0);
    });
  });

  describe("capturePane on dead process returns buffered output", () => {
    test("multiplexer returns last known output even when process is done", async () => {
      // Simulate: process already exited, but buffer still has data
      const captures = new Map<string, string[]>();
      captures.set("dead-pane", [
        "build output line 1\nbuild output line 2\nexit 0",
        "build output line 1\nbuild output line 2\nexit 0",
      ]);

      const mux = new MockMultiplexer(captures);
      const result = await dispatchToAgent(
        "dead-pane",
        "make build",
        1,
        { transport: "axon", ...FAST_POLL },
        mux,
      );

      // Content doesn't change (process already exited with all output flushed)
      // so received will be false, but the capture still works
      expect(result.dispatched).toBe(true);
      // The pane content is the same both times, so received is false
      expect(result.received).toBe(false);
    });
  });

  describe("backward compatibility", () => {
    test("no multiplexer and transport=tmux falls back to TmuxClient path", async () => {
      // Without a multiplexer AND with tmux transport, the function should use TmuxClient
      // In test environment without tmux, the pane won't change, so received=false
      const result = await dispatchToAgent(
        "%99999",
        "echo test",
        1,
        { receiptPollIntervalMs: 10, receiptPollAttempts: 1 },
        undefined, // no multiplexer
      );

      expect(result.dispatched).toBe(true);
      expect(result.received).toBe(false);
    });
  });
});
