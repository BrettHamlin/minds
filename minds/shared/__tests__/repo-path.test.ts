/**
 * repo-path.test.ts — Tests for repo-qualified path parsing (MR-004).
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import {
  parseRepoPath,
  formatRepoPath,
  resolveRepoPath,
  stripRepoPrefix,
  getRepoAlias,
} from "../repo-path.ts";

// ─── parseRepoPath ──────────────────────────────────────────────────────────

describe("parseRepoPath", () => {
  test("with repo prefix", () => {
    expect(parseRepoPath("backend:src/api/**")).toEqual({
      repo: "backend",
      path: "src/api/**",
    });
  });

  test("without repo prefix", () => {
    expect(parseRepoPath("src/api/**")).toEqual({
      repo: undefined,
      path: "src/api/**",
    });
  });

  test("empty path after prefix", () => {
    expect(parseRepoPath("backend:")).toEqual({
      repo: "backend",
      path: "",
    });
  });

  test("empty alias (colon at start) treated as bare path", () => {
    expect(parseRepoPath(":src/api/**")).toEqual({
      repo: undefined,
      path: ":src/api/**",
    });
  });

  test("empty string", () => {
    expect(parseRepoPath("")).toEqual({
      repo: undefined,
      path: "",
    });
  });

  test("multiple colons — splits on first only", () => {
    expect(parseRepoPath("backend:src:api")).toEqual({
      repo: "backend",
      path: "src:api",
    });
  });

  test("alias with hyphens and underscores", () => {
    expect(parseRepoPath("my-repo_v2:src/lib")).toEqual({
      repo: "my-repo_v2",
      path: "src/lib",
    });
  });
});

// ─── formatRepoPath ─────────────────────────────────────────────────────────

describe("formatRepoPath", () => {
  test("with repo", () => {
    expect(formatRepoPath("backend", "src/api/**")).toBe("backend:src/api/**");
  });

  test("without repo", () => {
    expect(formatRepoPath(undefined, "src/api/**")).toBe("src/api/**");
  });

  test("roundtrip property holds", () => {
    const original = "backend:src/api/**";
    const { repo, path } = parseRepoPath(original);
    expect(formatRepoPath(repo, path)).toBe(original);
  });

  test("roundtrip for bare path", () => {
    const original = "src/api/**";
    const { repo, path } = parseRepoPath(original);
    expect(formatRepoPath(repo, path)).toBe(original);
  });
});

// ─── resolveRepoPath ────────────────────────────────────────────────────────

describe("resolveRepoPath", () => {
  const repoPaths = new Map([
    ["backend", "/repos/backend"],
    ["frontend", "/repos/frontend"],
  ]);
  const defaultRoot = "/repos/main";

  test("known alias resolves to repo root + path", () => {
    expect(resolveRepoPath("backend:src/api/handler.ts", repoPaths, defaultRoot)).toBe(
      resolve("/repos/backend", "src/api/handler.ts"),
    );
  });

  test("unknown alias throws", () => {
    expect(() =>
      resolveRepoPath("missing:src/foo.ts", repoPaths, defaultRoot),
    ).toThrow('Unknown repo alias "missing"');
  });

  test("bare path uses default root", () => {
    expect(resolveRepoPath("src/lib/utils.ts", repoPaths, defaultRoot)).toBe(
      resolve("/repos/main", "src/lib/utils.ts"),
    );
  });

  test("empty repoPaths — bare path still works", () => {
    expect(resolveRepoPath("src/foo.ts", new Map(), "/default")).toBe(
      resolve("/default", "src/foo.ts"),
    );
  });

  test("empty repoPaths — prefixed path throws", () => {
    expect(() =>
      resolveRepoPath("backend:src/foo.ts", new Map(), "/default"),
    ).toThrow('Unknown repo alias "backend"');
  });
});

// ─── stripRepoPrefix ────────────────────────────────────────────────────────

describe("stripRepoPrefix", () => {
  test("strips prefix", () => {
    expect(stripRepoPrefix("backend:src/api/**")).toBe("src/api/**");
  });

  test("bare path unchanged", () => {
    expect(stripRepoPrefix("src/api/**")).toBe("src/api/**");
  });

  test("empty string unchanged", () => {
    expect(stripRepoPrefix("")).toBe("");
  });
});

// ─── getRepoAlias ───────────────────────────────────────────────────────────

describe("getRepoAlias", () => {
  test("returns alias when present", () => {
    expect(getRepoAlias("backend:src/api/**")).toBe("backend");
  });

  test("returns undefined for bare path", () => {
    expect(getRepoAlias("src/api/**")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(getRepoAlias("")).toBeUndefined();
  });

  test("returns alias for path with multiple colons", () => {
    expect(getRepoAlias("backend:src:api")).toBe("backend");
  });
});
