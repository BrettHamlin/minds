/**
 * Unit tests for src/cli/lib/semver.ts
 * 30+ cases covering parse, compare, satisfies, range evaluation, edge cases.
 */

import { describe, test, expect } from "bun:test";
import {
  parse,
  tryParse,
  compare,
  compareStr,
  satisfies,
  maxVersion,
  minVersion,
  bestMatch,
  format,
} from "../../minds/cli/lib/semver.js";

// ─── parse ───────────────────────────────────────────────────────────────────

describe("parse", () => {
  test("parses basic semver", () => {
    const v = parse("1.2.3");
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
    expect(v.prerelease).toEqual([]);
    expect(v.buildmetadata).toEqual([]);
  });

  test("parses v-prefixed version", () => {
    const v = parse("v2.0.0");
    expect(v.major).toBe(2);
    expect(v.minor).toBe(0);
    expect(v.patch).toBe(0);
  });

  test("parses version with pre-release", () => {
    const v = parse("1.2.3-alpha.1");
    expect(v.prerelease).toEqual(["alpha", "1"]);
  });

  test("parses version with build metadata", () => {
    const v = parse("1.2.3+build.20241201");
    expect(v.buildmetadata).toEqual(["build", "20241201"]);
  });

  test("parses version with pre-release and build metadata", () => {
    const v = parse("1.2.3-beta.2+build.001");
    expect(v.prerelease).toEqual(["beta", "2"]);
    expect(v.buildmetadata).toEqual(["build", "001"]);
  });

  test("parses zeros", () => {
    const v = parse("0.0.0");
    expect(v.major).toBe(0);
    expect(v.minor).toBe(0);
    expect(v.patch).toBe(0);
  });

  test("throws on invalid string", () => {
    expect(() => parse("not-a-version")).toThrow();
    expect(() => parse("1.2")).toThrow();
    expect(() => parse("")).toThrow();
    expect(() => parse("1.2.x")).toThrow();
  });

  test("throws on negative components", () => {
    expect(() => parse("-1.2.3")).toThrow();
  });
});

// ─── tryParse ────────────────────────────────────────────────────────────────

describe("tryParse", () => {
  test("returns SemVer for valid string", () => {
    expect(tryParse("1.0.0")).not.toBeNull();
  });

  test("returns null for invalid string", () => {
    expect(tryParse("not-semver")).toBeNull();
    expect(tryParse("")).toBeNull();
  });
});

// ─── compare ─────────────────────────────────────────────────────────────────

describe("compare", () => {
  test("equal versions return 0", () => {
    expect(compare(parse("1.2.3"), parse("1.2.3"))).toBe(0);
  });

  test("major version takes precedence", () => {
    expect(compare(parse("2.0.0"), parse("1.9.9"))).toBe(1);
    expect(compare(parse("1.0.0"), parse("2.0.0"))).toBe(-1);
  });

  test("minor version comparison", () => {
    expect(compare(parse("1.2.0"), parse("1.1.9"))).toBe(1);
    expect(compare(parse("1.1.0"), parse("1.2.0"))).toBe(-1);
  });

  test("patch version comparison", () => {
    expect(compare(parse("1.0.2"), parse("1.0.1"))).toBe(1);
    expect(compare(parse("1.0.0"), parse("1.0.1"))).toBe(-1);
  });

  test("release beats pre-release at same version", () => {
    expect(compare(parse("1.0.0"), parse("1.0.0-alpha"))).toBe(1);
    expect(compare(parse("1.0.0-alpha"), parse("1.0.0"))).toBe(-1);
  });

  test("numeric pre-release fields compared as integers", () => {
    expect(compare(parse("1.0.0-2"), parse("1.0.0-10"))).toBe(-1);
    expect(compare(parse("1.0.0-10"), parse("1.0.0-2"))).toBe(1);
  });

  test("alphanumeric pre-release beats numeric", () => {
    expect(compare(parse("1.0.0-alpha"), parse("1.0.0-1"))).toBe(1);
  });

  test("longer pre-release beats shorter when common prefix equal", () => {
    expect(compare(parse("1.0.0-alpha.1"), parse("1.0.0-alpha"))).toBe(1);
  });

  test("build metadata ignored for precedence", () => {
    expect(compare(parse("1.0.0+build1"), parse("1.0.0+build2"))).toBe(0);
  });

  test("compareStr convenience wrapper", () => {
    expect(compareStr("1.0.0", "2.0.0")).toBe(-1);
    expect(compareStr("1.0.0", "1.0.0")).toBe(0);
  });
});

// ─── satisfies ───────────────────────────────────────────────────────────────

describe("satisfies", () => {
  // Wildcard
  test("* matches any version", () => {
    expect(satisfies("1.2.3", "*")).toBe(true);
    expect(satisfies("0.0.1", "*")).toBe(true);
  });

  test("empty range matches any version", () => {
    expect(satisfies("1.2.3", "")).toBe(true);
  });

  // Exact
  test("exact match", () => {
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "1.2.3")).toBe(false);
  });

  test("explicit = exact match", () => {
    expect(satisfies("1.2.3", "=1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "=1.2.3")).toBe(false);
  });

  // >= <=
  test(">= range", () => {
    expect(satisfies("1.6.0", ">=1.6")).toBe(true);
    expect(satisfies("1.5.9", ">=1.6.0")).toBe(false);
    expect(satisfies("2.0.0", ">=1.6.0")).toBe(true);
  });

  test("<= range", () => {
    expect(satisfies("1.5.9", "<=1.6.0")).toBe(true);
    expect(satisfies("1.6.0", "<=1.6.0")).toBe(true);
    expect(satisfies("1.6.1", "<=1.6.0")).toBe(false);
  });

  test("> range", () => {
    expect(satisfies("1.6.1", ">1.6.0")).toBe(true);
    expect(satisfies("1.6.0", ">1.6.0")).toBe(false);
  });

  test("< range", () => {
    expect(satisfies("1.5.9", "<1.6.0")).toBe(true);
    expect(satisfies("1.6.0", "<1.6.0")).toBe(false);
  });

  // Caret
  test("^ caret range: major version compatibility", () => {
    expect(satisfies("1.2.3", "^1.0.0")).toBe(true);
    expect(satisfies("1.9.9", "^1.2.3")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "^1.2.3")).toBe(false);
  });

  test("^ caret range: 0.x compatibility", () => {
    expect(satisfies("0.2.3", "^0.2.0")).toBe(true);
    expect(satisfies("0.3.0", "^0.2.0")).toBe(false);
    expect(satisfies("0.2.99", "^0.2.0")).toBe(true);
  });

  test("^ caret range: 0.0.x compatibility", () => {
    expect(satisfies("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfies("0.0.4", "^0.0.3")).toBe(false);
  });

  // Tilde
  test("~ tilde range: patch-level compatibility", () => {
    expect(satisfies("1.2.5", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "~1.2.3")).toBe(false);
  });

  // Pre-release
  test("pre-release in version", () => {
    expect(satisfies("1.0.0-alpha.1", ">=1.0.0-alpha")).toBe(true);
    expect(satisfies("1.0.0-alpha.1", "1.0.0-alpha.1")).toBe(true);
    expect(satisfies("1.0.0-alpha.1", "1.0.0-alpha.2")).toBe(false);
  });

  // Invalid inputs
  test("invalid version string returns false", () => {
    expect(satisfies("not-a-version", ">=1.0.0")).toBe(false);
  });
});

// ─── maxVersion / minVersion / bestMatch ─────────────────────────────────────

describe("maxVersion", () => {
  test("returns highest version", () => {
    expect(maxVersion(["1.0.0", "2.0.0", "1.5.0"])).toBe("2.0.0");
  });

  test("returns undefined for empty array", () => {
    expect(maxVersion([])).toBeUndefined();
  });

  test("single element", () => {
    expect(maxVersion(["3.1.4"])).toBe("3.1.4");
  });
});

describe("minVersion", () => {
  test("returns lowest version", () => {
    expect(minVersion(["1.0.0", "2.0.0", "0.5.0"])).toBe("0.5.0");
  });
});

describe("bestMatch", () => {
  test("finds highest version satisfying range", () => {
    expect(bestMatch(["1.0.0", "1.2.0", "2.0.0"], "^1.0.0")).toBe("1.2.0");
  });

  test("returns undefined if no match", () => {
    expect(bestMatch(["1.0.0", "1.1.0"], "^2.0.0")).toBeUndefined();
  });
});

// ─── format ──────────────────────────────────────────────────────────────────

describe("format", () => {
  test("formats basic semver", () => {
    expect(format(parse("1.2.3"))).toBe("1.2.3");
  });

  test("formats with prerelease", () => {
    expect(format(parse("1.2.3-alpha.1"))).toBe("1.2.3-alpha.1");
  });

  test("strips build metadata", () => {
    expect(format(parse("1.2.3+build.001"))).toBe("1.2.3");
  });
});
