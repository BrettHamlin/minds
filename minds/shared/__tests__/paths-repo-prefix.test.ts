/**
 * paths-repo-prefix.test.ts — Tests for matchesOwnership with repo-prefixed patterns (MR-021).
 *
 * Verifies that matchesOwnership strips repo prefixes defensively,
 * so patterns like "backend:src/api/**" match file paths like "src/api/foo.ts".
 */

import { describe, test, expect } from "bun:test";
import { matchesOwnership } from "../paths.ts";

describe("matchesOwnership — repo-prefixed patterns (MR-021)", () => {
  test("matches repo-prefixed pattern against bare file path", () => {
    expect(matchesOwnership("src/api/foo.ts", ["backend:src/api/**"])).toBe(true);
  });

  test("still matches non-prefixed pattern (backward compat)", () => {
    expect(matchesOwnership("src/api/foo.ts", ["src/api/**"])).toBe(true);
  });

  test("rejects file outside repo-prefixed pattern", () => {
    expect(matchesOwnership("src/other/foo.ts", ["backend:src/api/**"])).toBe(false);
  });

  test("handles multiple patterns with mixed prefixes", () => {
    const patterns = ["backend:src/api/**", "frontend:src/ui/**", "src/shared/**"];
    expect(matchesOwnership("src/api/handler.ts", patterns)).toBe(true);
    expect(matchesOwnership("src/ui/button.ts", patterns)).toBe(true);
    expect(matchesOwnership("src/shared/utils.ts", patterns)).toBe(true);
    expect(matchesOwnership("src/unrelated/foo.ts", patterns)).toBe(false);
  });

  test("handles .minds/ prefix with repo prefix", () => {
    expect(matchesOwnership(".minds/transport/bus.ts", ["backend:.minds/transport/**"])).toBe(true);
    expect(matchesOwnership("minds/transport/bus.ts", ["backend:.minds/transport/**"])).toBe(true);
  });

  test("handles bare colon prefix (:src/api/**)", () => {
    // parseRepoPath strips leading colon, treats as bare path
    expect(matchesOwnership("src/api/foo.ts", [":src/api/**"])).toBe(true);
    expect(matchesOwnership("src/other/foo.ts", [":src/api/**"])).toBe(false);
  });

  test("repo prefix with no glob (trailing slash only)", () => {
    expect(matchesOwnership("src/api/foo.ts", ["backend:src/api/"])).toBe(true);
    expect(matchesOwnership("src/other/foo.ts", ["backend:src/api/"])).toBe(false);
  });
});
