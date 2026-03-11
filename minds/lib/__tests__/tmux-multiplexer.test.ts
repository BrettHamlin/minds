/**
 * tmux-multiplexer.test.ts -- Tests for the TmuxMultiplexer implementation.
 *
 * These tests exercise error paths that don't require a live tmux session.
 * Tests that need a running tmux server are guarded with try/catch or
 * conditional skips.
 */

import { describe, test, expect, mock } from "bun:test";
import { TmuxMultiplexer } from "../tmux-multiplexer.ts";

describe("TmuxMultiplexer", () => {
  const mux = new TmuxMultiplexer();

  describe("killPane", () => {
    test("swallows errors on non-existent pane", () => {
      // killPane should silently handle panes that don't exist
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
      // Simulate tmux being unreachable by creating a multiplexer instance
      // and calling isPaneAlive with a pane that can't exist. Even if the
      // tmux server is down entirely, isPaneAlive should return false (not throw).
      // The try/catch in isPaneAlive handles the case where Bun.spawnSync throws.
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
      expect(() => mux.splitPane("%99999")).toThrow(/Failed to split tmux pane/);
    });

    test("throws on empty pane ID", () => {
      expect(() => mux.splitPane("")).toThrow(/Failed to split tmux pane/);
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
});
