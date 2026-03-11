/**
 * paths.test.ts — Tests for shared path utilities (stripGlob, matchesOwnership).
 */

import { describe, test, expect } from "bun:test";
import { stripGlob, matchesOwnership } from "../paths.ts";

// ---------------------------------------------------------------------------
// stripGlob
// ---------------------------------------------------------------------------

describe("stripGlob", () => {
  test("strips trailing ** from glob pattern", () => {
    expect(stripGlob("src/api/**")).toBe("src/api/");
  });

  test("strips trailing * from glob pattern", () => {
    expect(stripGlob("src/api/*")).toBe("src/api/");
  });

  test("preserves trailing slash on directory prefix", () => {
    expect(stripGlob("src/api/")).toBe("src/api/");
  });

  test("preserves bare path without glob or slash", () => {
    expect(stripGlob("src/api")).toBe("src/api");
  });

  test("handles deeply nested glob path", () => {
    expect(stripGlob("src/middleware/cors/**")).toBe("src/middleware/cors/");
  });

  test("strips bare ** with no leading slash", () => {
    expect(stripGlob("**")).toBe("");
  });

  test("strips bare * with no leading slash", () => {
    expect(stripGlob("*")).toBe("");
  });

  test("handles empty string", () => {
    expect(stripGlob("")).toBe("");
  });

  test("strips .minds/ prefixed glob pattern", () => {
    expect(stripGlob(".minds/transport/**")).toBe(".minds/transport/");
  });

  test("handles path with single trailing star after slash", () => {
    expect(stripGlob("src/api/routes/*")).toBe("src/api/routes/");
  });

  test("handles triple star (pathological glob)", () => {
    // regex matches one or more trailing *, so *** is stripped
    expect(stripGlob("src/api/***")).toBe("src/api/");
  });
});

// ---------------------------------------------------------------------------
// matchesOwnership
// ---------------------------------------------------------------------------

describe("matchesOwnership", () => {
  test("matches file within owned directory (trailing slash)", () => {
    expect(matchesOwnership("src/api/foo.ts", ["src/api/"])).toBe(true);
  });

  test("matches file within owned directory (glob suffix)", () => {
    expect(matchesOwnership("src/api/foo.ts", ["src/api/**"])).toBe(true);
  });

  test("rejects file outside owned directory", () => {
    expect(matchesOwnership("src/models/foo.ts", ["src/api/**"])).toBe(false);
  });

  test("handles multiple owns_files prefixes", () => {
    expect(matchesOwnership("src/models/foo.ts", ["src/api/**", "src/models/**"])).toBe(true);
  });

  test("returns false for empty ownsFiles", () => {
    expect(matchesOwnership("src/api/foo.ts", [])).toBe(false);
  });

  test("normalizes .minds/ to minds/ for file path", () => {
    expect(matchesOwnership(".minds/transport/publish.ts", ["minds/transport/"])).toBe(true);
  });

  test("normalizes .minds/ to minds/ for owns_files prefix", () => {
    expect(matchesOwnership("minds/transport/publish.ts", [".minds/transport/"])).toBe(true);
  });

  test("matches nested file in glob-suffixed prefix", () => {
    expect(matchesOwnership("src/middleware/cors/index.ts", ["src/middleware/cors/**"])).toBe(true);
  });

  test("rejects sibling directory of glob-suffixed prefix", () => {
    expect(matchesOwnership("src/middleware/csrf/index.ts", ["src/middleware/cors/**"])).toBe(false);
  });

  test("rejects path that is a prefix of the owned directory name", () => {
    // "src/ap" should NOT match "src/api/" — prefix matching is on the owned dir, not the file
    expect(matchesOwnership("src/ap", ["src/api/**"])).toBe(false);
  });

  test("matches file at exact directory boundary (no subdirectory)", () => {
    // File directly in the owned directory, not nested
    expect(matchesOwnership("src/api/handler.ts", ["src/api/"])).toBe(true);
  });

  test("matches deeply nested file within owned prefix", () => {
    expect(matchesOwnership("src/api/v2/internal/auth/middleware.ts", ["src/api/**"])).toBe(true);
  });

  test("normalizes .minds/ on both file and prefix simultaneously", () => {
    expect(matchesOwnership(".minds/transport/foo.ts", [".minds/transport/"])).toBe(true);
  });

  test("rejects when file path partially overlaps prefix without full segment match", () => {
    // "src/api-v2/foo.ts" starts with "src/api" but not "src/api/" — only matches if
    // the prefix doesn't have a trailing slash after stripping
    expect(matchesOwnership("src/api-v2/foo.ts", ["src/api/**"])).toBe(false);
  });

  test("matches bare path prefix (no glob, no trailing slash)", () => {
    // stripGlob("src/api") returns "src/api" — so "src/api/foo.ts".startsWith("src/api") is true
    // This is expected behavior: bare prefix matches files within that directory
    expect(matchesOwnership("src/api/foo.ts", ["src/api"])).toBe(true);
  });

  test("bare prefix also matches path extensions (known behavior)", () => {
    // "src/api-v2/foo.ts".startsWith("src/api") is true — this is the bare prefix edge case
    // This documents the behavior; callers should use trailing slash or glob for precise matching
    expect(matchesOwnership("src/api-v2/foo.ts", ["src/api"])).toBe(true);
  });
});
