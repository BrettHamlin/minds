import { describe, test, expect, afterEach } from "bun:test";
import { isGitRepo, getRepoRoot } from "../../src/utils/git";
import { createTempGitRepo, createTempDir, cleanupTempDir } from "../helpers";

describe("git utils", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      cleanupTempDir(dir);
    }
    dirs.length = 0;
  });

  describe("isGitRepo", () => {
    test("returns true for a git-initialized directory", () => {
      const dir = createTempGitRepo();
      dirs.push(dir);
      expect(isGitRepo(dir)).toBe(true);
    });

    test("returns false for a non-git directory", () => {
      const dir = createTempDir();
      dirs.push(dir);
      expect(isGitRepo(dir)).toBe(false);
    });

    test("returns true for a subdirectory inside a git repo", () => {
      const dir = createTempGitRepo();
      dirs.push(dir);
      const { mkdirSync } = require("fs");
      const { join } = require("path");
      const subDir = join(dir, "nested", "subdir");
      mkdirSync(subDir, { recursive: true });
      expect(isGitRepo(subDir)).toBe(true);
    });
  });

  describe("getRepoRoot", () => {
    test("returns the repo root path for a git directory", () => {
      const dir = createTempGitRepo();
      dirs.push(dir);
      const root = getRepoRoot(dir);
      // realpath comparison since macOS /tmp symlinks to /private/tmp
      const { realpathSync } = require("fs");
      expect(realpathSync(root)).toBe(realpathSync(dir));
    });

    test("returns repo root from a subdirectory", () => {
      const dir = createTempGitRepo();
      dirs.push(dir);
      const { mkdirSync, realpathSync } = require("fs");
      const { join } = require("path");
      const subDir = join(dir, "deep", "nested");
      mkdirSync(subDir, { recursive: true });
      const root = getRepoRoot(subDir);
      expect(realpathSync(root)).toBe(realpathSync(dir));
    });

    test("throws for a non-git directory", () => {
      const dir = createTempDir();
      dirs.push(dir);
      expect(() => getRepoRoot(dir)).toThrow();
    });
  });
});
