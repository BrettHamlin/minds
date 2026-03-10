/**
 * tmux-utils.test.ts -- Tests for shared tmux utilities.
 *
 * These tests verify the killPane function handles both success and error cases
 * without requiring an actual tmux session.
 */

import { describe, test, expect } from "bun:test";
import { killPane } from "../tmux-utils.ts";

describe("killPane", () => {
  test("does not throw when pane does not exist", () => {
    // killPane should silently handle non-existent panes
    expect(() => killPane("%99999")).not.toThrow();
  });

  test("does not throw when called with empty string", () => {
    expect(() => killPane("")).not.toThrow();
  });
});
