/**
 * tmux-utils.test.ts -- Tests for shared tmux utilities.
 *
 * These tests verify the killPane function handles both success and error cases
 * without requiring an actual tmux session.
 */

import { describe, test, expect } from "bun:test";
import { killPane, shellQuote } from "../tmux-utils.ts";

describe("shellQuote", () => {
  test("wraps simple string in single quotes", () => {
    expect(shellQuote("/tmp/foo")).toBe("'/tmp/foo'");
  });

  test("escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test("handles spaces in paths", () => {
    expect(shellQuote("/tmp/my worktree")).toBe("'/tmp/my worktree'");
  });

  test("handles shell metacharacters", () => {
    expect(shellQuote("$(rm -rf /)")).toBe("'$(rm -rf /)'");
    expect(shellQuote("foo; bar")).toBe("'foo; bar'");
    expect(shellQuote("a && b")).toBe("'a && b'");
  });

  test("handles empty string", () => {
    expect(shellQuote("")).toBe("''");
  });
});

describe("killPane", () => {
  test("does not throw when pane does not exist", () => {
    // killPane should silently handle non-existent panes
    expect(() => killPane("%99999")).not.toThrow();
  });

  test("does not throw when called with empty string", () => {
    expect(() => killPane("")).not.toThrow();
  });
});
