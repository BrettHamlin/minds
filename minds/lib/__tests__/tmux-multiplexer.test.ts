/**
 * tmux-multiplexer.test.ts -- Tests for the TmuxMultiplexer implementation.
 *
 * These tests exercise error paths that don't require a live tmux session.
 * Tests that need a running tmux server are guarded with try/catch or
 * conditional skips.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { TmuxMultiplexer, PaneExhaustedError, DEFAULT_MAX_PANES } from "../tmux-multiplexer.ts";

describe("TmuxMultiplexer", () => {
  const mux = new TmuxMultiplexer();

  describe("killPane", () => {
    test("swallows errors on non-existent pane", () => {
      expect(() => mux.killPane("%99999")).not.toThrow();
    });

    test("swallows errors on empty pane ID", () => {
      expect(() => mux.killPane("")).not.toThrow();
    });

    test("swallows errors on garbage pane ID", () => {
      expect(() => mux.killPane("not-a-real-pane-id-!@#$")).not.toThrow();
    });
  });

  describe("isPaneAlive", () => {
    test("returns false for non-existent pane", () => {
      expect(mux.isPaneAlive("%99999")).toBe(false);
    });

    test("returns false for empty pane ID", () => {
      expect(mux.isPaneAlive("")).toBe(false);
    });

    test("returns false when tmux is unreachable", () => {
      const result = mux.isPaneAlive("%99999");
      expect(result).toBe(false);
    });
  });

  describe("getCurrentPane", () => {
    test("returns a string (may be empty if not in tmux)", () => {
      const pane = mux.getCurrentPane();
      expect(typeof pane).toBe("string");
    });
  });

  describe("splitPane", () => {
    test("throws on invalid/non-existent pane ID", () => {
      expect(() => mux.splitPane("%99999")).toThrow();
    });

    test("throws on empty pane ID", () => {
      expect(() => mux.splitPane("")).toThrow();
    });
  });

  describe("sendKeys", () => {
    test("throws on invalid/non-existent pane ID", () => {
      expect(() => mux.sendKeys("%99999", "echo hello")).toThrow(/Failed to send-keys/);
    });

    test("throws on empty pane ID", () => {
      expect(() => mux.sendKeys("", "echo hello")).toThrow(/Failed to send-keys/);
    });
  });

  describe("capturePane", () => {
    test("throws on invalid/non-existent pane ID", () => {
      expect(() => mux.capturePane("%99999")).toThrow(/Failed to capture pane/);
    });
  });

  describe("pane exhaustion guard", () => {
    test("splitPane throws PaneExhaustedError when count meets limit", () => {
      const stubMux = new TmuxMultiplexer({ maxPanes: 8 });
      (stubMux as any).countSessionPanes = () => 8;
      try {
        stubMux.splitPane("%0");
        // If we reach here, the guard didn't fire — but splitPane will also
        // throw a tmux error for the invalid pane. So catch either error type.
        throw new Error("Expected PaneExhaustedError");
      } catch (err) {
        expect(err).toBeInstanceOf(PaneExhaustedError);
        expect((err as PaneExhaustedError).currentCount).toBe(8);
        expect((err as PaneExhaustedError).maxPanes).toBe(8);
      }
    });

    test("splitPane throws PaneExhaustedError when count exceeds limit", () => {
      const stubMux = new TmuxMultiplexer({ maxPanes: 4 });
      (stubMux as any).countSessionPanes = () => 10;
      try {
        stubMux.splitPane("%0");
        throw new Error("Expected PaneExhaustedError");
      } catch (err) {
        expect(err).toBeInstanceOf(PaneExhaustedError);
        expect((err as PaneExhaustedError).currentCount).toBe(10);
        expect((err as PaneExhaustedError).maxPanes).toBe(4);
      }
    });

    test("splitPane proceeds when count is below limit (fails on tmux error, not guard)", () => {
      const stubMux = new TmuxMultiplexer({ maxPanes: 16 });
      (stubMux as any).countSessionPanes = () => 2;
      // Should NOT throw PaneExhaustedError — will throw tmux error for invalid pane
      try {
        stubMux.splitPane("%99999");
        throw new Error("Expected some error");
      } catch (err) {
        expect(err).not.toBeInstanceOf(PaneExhaustedError);
      }
    });

    test("splitPane proceeds with warning when count is null (fail-open)", () => {
      const stubMux = new TmuxMultiplexer({ maxPanes: 4 });
      (stubMux as any).countSessionPanes = () => null;
      // Should NOT throw PaneExhaustedError — will throw tmux error for invalid pane
      try {
        stubMux.splitPane("%99999");
        throw new Error("Expected some error");
      } catch (err) {
        expect(err).not.toBeInstanceOf(PaneExhaustedError);
        expect((err as Error).message).toContain("Failed to split tmux pane");
      }
    });
  });

  describe("constructor", () => {
    const originalEnv = process.env.MINDS_MAX_TMUX_PANES;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.MINDS_MAX_TMUX_PANES;
      } else {
        process.env.MINDS_MAX_TMUX_PANES = originalEnv;
      }
    });

    test("DEFAULT_MAX_PANES is 16", () => {
      expect(DEFAULT_MAX_PANES).toBe(16);
    });

    test("uses DEFAULT_MAX_PANES when no options or env var", () => {
      delete process.env.MINDS_MAX_TMUX_PANES;
      const m = new TmuxMultiplexer();
      // Verify by stubbing countSessionPanes to return 15 (below 16) — should not throw guard
      (m as any).countSessionPanes = () => 15;
      try {
        m.splitPane("%99999");
      } catch (err) {
        expect(err).not.toBeInstanceOf(PaneExhaustedError);
      }
      // And at 16 — should throw guard
      (m as any).countSessionPanes = () => 16;
      expect(() => m.splitPane("%99999")).toThrow(PaneExhaustedError);
    });

    test("accepts custom maxPanes via constructor", () => {
      const m = new TmuxMultiplexer({ maxPanes: 4 });
      (m as any).countSessionPanes = () => 4;
      expect(() => m.splitPane("%99999")).toThrow(PaneExhaustedError);
    });

    test("reads maxPanes from MINDS_MAX_TMUX_PANES env var", () => {
      process.env.MINDS_MAX_TMUX_PANES = "5";
      const m = new TmuxMultiplexer();
      (m as any).countSessionPanes = () => 5;
      expect(() => m.splitPane("%99999")).toThrow(PaneExhaustedError);
    });

    test("constructor option takes precedence over env var", () => {
      process.env.MINDS_MAX_TMUX_PANES = "100";
      const m = new TmuxMultiplexer({ maxPanes: 3 });
      (m as any).countSessionPanes = () => 3;
      expect(() => m.splitPane("%99999")).toThrow(PaneExhaustedError);
    });

    test("falls back to DEFAULT_MAX_PANES when env var is NaN", () => {
      process.env.MINDS_MAX_TMUX_PANES = "banana";
      const m = new TmuxMultiplexer();
      // Should use DEFAULT_MAX_PANES (16), not NaN
      (m as any).countSessionPanes = () => 15;
      try {
        m.splitPane("%99999");
      } catch (err) {
        // Should NOT be PaneExhaustedError (15 < 16)
        expect(err).not.toBeInstanceOf(PaneExhaustedError);
      }
      // At 16 — should throw
      (m as any).countSessionPanes = () => 16;
      expect(() => m.splitPane("%99999")).toThrow(PaneExhaustedError);
    });

    test("falls back to DEFAULT_MAX_PANES when env var is zero", () => {
      process.env.MINDS_MAX_TMUX_PANES = "0";
      const m = new TmuxMultiplexer();
      (m as any).countSessionPanes = () => 15;
      try {
        m.splitPane("%99999");
      } catch (err) {
        expect(err).not.toBeInstanceOf(PaneExhaustedError);
      }
    });

    test("falls back to DEFAULT_MAX_PANES when env var is negative", () => {
      process.env.MINDS_MAX_TMUX_PANES = "-5";
      const m = new TmuxMultiplexer();
      (m as any).countSessionPanes = () => 15;
      try {
        m.splitPane("%99999");
      } catch (err) {
        expect(err).not.toBeInstanceOf(PaneExhaustedError);
      }
    });

    test("falls back to DEFAULT_MAX_PANES when constructor maxPanes is NaN", () => {
      const m = new TmuxMultiplexer({ maxPanes: NaN });
      (m as any).countSessionPanes = () => 16;
      expect(() => m.splitPane("%99999")).toThrow(PaneExhaustedError);
    });
  });

  describe("PaneExhaustedError", () => {
    test("has correct name and properties", () => {
      const err = new PaneExhaustedError(10, 10);
      expect(err.name).toBe("PaneExhaustedError");
      expect(err.currentCount).toBe(10);
      expect(err.maxPanes).toBe(10);
      expect(err.message).toContain("10 panes exist");
      expect(err.message).toContain("max is 10");
    });

    test("is instanceof Error", () => {
      const err = new PaneExhaustedError(5, 5);
      expect(err).toBeInstanceOf(Error);
    });
  });
});
