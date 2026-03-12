/**
 * implement-registry-multirepo.test.ts — Unit tests for multi-repo registry loading (MR-009).
 *
 * Tests loadMultiRepoRegistries behavior: per-repo loading, repo tagging,
 * name collision detection, and missing minds.json handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync } from "fs";
import { join } from "path";
import { loadMultiRepoRegistries } from "../../../shared/registry-loader.ts";
import { tempDir, initGitRepo, writeMindsJson } from "./helpers/multi-repo-setup.ts";
import type { MindDescription } from "../../../mind.ts";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("loadMultiRepoRegistries (MR-009)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = tempDir("impl-reg-test");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("loads minds from each repo and tags with repo alias", () => {
    const backendDir = join(tmpRoot, "backend");
    const frontendDir = join(tmpRoot, "frontend");
    initGitRepo(backendDir);
    initGitRepo(frontendDir);

    writeMindsJson(backendDir, [
      { name: "api", description: "API mind", owns_files: ["src/api/**"], produces: [], consumes: [] },
    ]);
    writeMindsJson(frontendDir, [
      { name: "ui", description: "UI mind", owns_files: ["src/components/**"], produces: [], consumes: [] },
    ]);

    const repoPaths = new Map([["backend", backendDir], ["frontend", frontendDir]]);
    const result = loadMultiRepoRegistries(repoPaths);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("api");
    expect(result[0].repo).toBe("backend");
    expect(result[1].name).toBe("ui");
    expect(result[1].repo).toBe("frontend");
  });

  it("throws on name collision across repos", () => {
    const backendDir = join(tmpRoot, "backend");
    const frontendDir = join(tmpRoot, "frontend");
    initGitRepo(backendDir);
    initGitRepo(frontendDir);

    writeMindsJson(backendDir, [
      { name: "shared", description: "Shared in backend", owns_files: ["src/shared/**"], produces: [], consumes: [] },
    ]);
    writeMindsJson(frontendDir, [
      { name: "shared", description: "Shared in frontend", owns_files: ["src/shared/**"], produces: [], consumes: [] },
    ]);

    const repoPaths = new Map([["backend", backendDir], ["frontend", frontendDir]]);
    expect(() => loadMultiRepoRegistries(repoPaths)).toThrow(/Mind name collision.*shared/);
  });

  it("silently skips repos without minds.json", () => {
    const backendDir = join(tmpRoot, "backend");
    const emptyDir = join(tmpRoot, "empty");
    initGitRepo(backendDir);
    initGitRepo(emptyDir);

    writeMindsJson(backendDir, [
      { name: "api", description: "API mind", owns_files: ["src/api/**"], produces: [], consumes: [] },
    ]);
    // emptyDir has no .minds/minds.json

    const repoPaths = new Map([["backend", backendDir], ["empty", emptyDir]]);
    const result = loadMultiRepoRegistries(repoPaths);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("api");
  });

  it("single-repo manifest still works", () => {
    const soloDir = join(tmpRoot, "solo");
    initGitRepo(soloDir);

    writeMindsJson(soloDir, [
      { name: "core", description: "Core mind", owns_files: ["src/**"], produces: [], consumes: [] },
    ]);

    const repoPaths = new Map([["solo", soloDir]]);
    const result = loadMultiRepoRegistries(repoPaths);

    expect(result).toHaveLength(1);
    expect(result[0].repo).toBe("solo");
  });

  it("multiple minds in same repo all tagged correctly", () => {
    const backendDir = join(tmpRoot, "backend");
    initGitRepo(backendDir);

    writeMindsJson(backendDir, [
      { name: "api", description: "API", owns_files: ["src/api/**"], produces: [], consumes: [] },
      { name: "auth", description: "Auth", owns_files: ["src/auth/**"], produces: [], consumes: [] },
    ]);

    const repoPaths = new Map([["backend", backendDir]]);
    const result = loadMultiRepoRegistries(repoPaths);

    expect(result).toHaveLength(2);
    expect(result.every(m => m.repo === "backend")).toBe(true);
  });
});
