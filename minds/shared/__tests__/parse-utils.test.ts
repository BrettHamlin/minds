/**
 * parse-utils.test.ts — Tests for shared parsing utilities.
 */

import { describe, test, expect } from "bun:test";
import { extractLastJsonLine } from "../parse-utils.ts";

describe("extractLastJsonLine", () => {
  test("extracts JSON from single line", () => {
    expect(extractLastJsonLine('{"ok":true}')).toBe('{"ok":true}');
  });

  test("extracts last JSON line from multiline output", () => {
    const output = `some log line\nanother log line\n{"drone_pane":"%99","worktree":"/tmp/wt"}`;
    expect(extractLastJsonLine(output)).toBe('{"drone_pane":"%99","worktree":"/tmp/wt"}');
  });

  test("extracts last JSON line when non-JSON follows", () => {
    // Only lines starting with { are candidates
    const output = `log\n{"first":1}\nmore log\n{"second":2}\nfinal log`;
    expect(extractLastJsonLine(output)).toBe('{"second":2}');
  });

  test("returns null when no JSON line found", () => {
    expect(extractLastJsonLine("no json here\njust text")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractLastJsonLine("")).toBeNull();
  });

  test("handles trailing whitespace/newlines", () => {
    const output = `log\n{"result":true}\n\n`;
    expect(extractLastJsonLine(output)).toBe('{"result":true}');
  });
});
