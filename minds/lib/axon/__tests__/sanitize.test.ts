/**
 * sanitize.test.ts -- Tests for sanitizeProcessId utility.
 *
 * Validates that arbitrary strings (including tmux-style pane IDs)
 * are correctly transformed into valid Axon ProcessId format.
 */

import { describe, test, expect } from "bun:test";
import { sanitizeProcessId } from "../types.ts";

describe("sanitizeProcessId", () => {
  test("passes through already-valid IDs unchanged", () => {
    expect(sanitizeProcessId("my-proc")).toBe("my-proc");
    expect(sanitizeProcessId("proc_123")).toBe("proc_123");
    expect(sanitizeProcessId("a")).toBe("a");
    expect(sanitizeProcessId("ABC-def_123")).toBe("ABC-def_123");
  });

  test("replaces % with hyphen (tmux pane IDs)", () => {
    expect(sanitizeProcessId("%42")).toBe("42");
    expect(sanitizeProcessId("%0")).toBe("0");
    expect(sanitizeProcessId("pane-%5")).toBe("pane-5");
  });

  test("replaces other invalid characters with hyphens", () => {
    expect(sanitizeProcessId("hello world")).toBe("hello-world");
    expect(sanitizeProcessId("proc.name")).toBe("proc-name");
    expect(sanitizeProcessId("proc/name")).toBe("proc-name");
    expect(sanitizeProcessId("proc@name")).toBe("proc-name");
  });

  test("collapses consecutive hyphens", () => {
    expect(sanitizeProcessId("a%%b")).toBe("a-b");
    expect(sanitizeProcessId("a...b")).toBe("a-b");
  });

  test("removes leading and trailing hyphens", () => {
    expect(sanitizeProcessId("%leading")).toBe("leading");
    expect(sanitizeProcessId("trailing%")).toBe("trailing");
    expect(sanitizeProcessId("%%middle%%")).toBe("middle");
  });

  test("truncates to 64 characters", () => {
    const longInput = "a".repeat(100);
    const result = sanitizeProcessId(longInput);
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result).toBe("a".repeat(64));
  });

  test("returns 'unnamed' for empty string", () => {
    expect(sanitizeProcessId("")).toBe("unnamed");
  });

  test("returns 'unnamed' for string that becomes empty after sanitization", () => {
    expect(sanitizeProcessId("%%%")).toBe("unnamed");
    expect(sanitizeProcessId("...")).toBe("unnamed");
  });
});
