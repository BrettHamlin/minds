/**
 * workspace-loader.test.ts — Tests for workspace manifest loading (MR-002).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { loadWorkspace } from "../workspace-loader.ts";
import { WORKSPACE_MANIFEST_FILENAME } from "../workspace.ts";
import { initGitRepo } from "../../cli/commands/__tests__/helpers/multi-repo-setup.ts";

import { tmpdir } from "os";
const TMP_ROOT = join(tmpdir(), ".tmp-workspace-loader-test");

function freshDir(subdir?: string): string {
  const dir = subdir ? join(TMP_ROOT, subdir) : TMP_ROOT;
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  writeFileSync(
    join(dir, WORKSPACE_MANIFEST_FILENAME),
    JSON.stringify(manifest),
  );
}

function validManifest(repoADir: string, repoBDir?: string): Record<string, unknown> {
  const repos: Array<Record<string, unknown>> = [
    { alias: "repo-a", path: repoADir },
  ];
  if (repoBDir) {
    repos.push({ alias: "repo-b", path: repoBDir });
  }
  return {
    version: 1,
    orchestratorRepo: "repo-a",
    repos,
  };
}

describe("loadWorkspace", () => {
  beforeEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
    mkdirSync(TMP_ROOT, { recursive: true });
    // Clear env var
    delete process.env.MINDS_WORKSPACE;
  });

  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
    delete process.env.MINDS_WORKSPACE;
  });

  // ── Single-repo fallback ─────────────────────────────────────────────────

  test("no manifest returns single-repo fallback", () => {
    const repoRoot = freshDir("empty-repo");
    initGitRepo(repoRoot);

    const ws = loadWorkspace(repoRoot);

    expect(ws.isMultiRepo).toBe(false);
    expect(ws.manifest).toBeNull();
    expect(ws.repoPaths.size).toBe(0);
    expect(ws.orchestratorRoot).toBe(repoRoot);
  });

  // ── Manifest at <repoRoot>/minds-workspace.json ──────────────────────────

  test("manifest in repo root loads correctly", () => {
    const repoRoot = freshDir("repo-in-root");
    initGitRepo(repoRoot);

    // repo-a is the repo root itself
    writeManifest(repoRoot, {
      version: 1,
      orchestratorRepo: "repo-a",
      repos: [{ alias: "repo-a", path: "." }],
    });

    const ws = loadWorkspace(repoRoot);

    expect(ws.isMultiRepo).toBe(false); // single repo
    expect(ws.manifest).not.toBeNull();
    expect(ws.repoPaths.get("repo-a")).toBe(resolve(repoRoot, "."));
    expect(ws.orchestratorRoot).toBe(resolve(repoRoot, "."));
  });

  // ── Manifest at <repoRoot>/../minds-workspace.json ───────────────────────

  test("manifest in parent dir loads correctly", () => {
    const parentDir = freshDir("parent");
    const repoA = freshDir("parent/repo-a");
    const repoB = freshDir("parent/repo-b");
    initGitRepo(repoA);
    initGitRepo(repoB);

    writeManifest(parentDir, {
      version: 1,
      orchestratorRepo: "repo-a",
      repos: [
        { alias: "repo-a", path: "./repo-a" },
        { alias: "repo-b", path: "./repo-b" },
      ],
    });

    const ws = loadWorkspace(repoA);

    expect(ws.isMultiRepo).toBe(true);
    expect(ws.manifest).not.toBeNull();
    expect(ws.repoPaths.get("repo-a")).toBe(resolve(parentDir, "repo-a"));
    expect(ws.repoPaths.get("repo-b")).toBe(resolve(parentDir, "repo-b"));
    expect(ws.orchestratorRoot).toBe(resolve(parentDir, "repo-a"));
  });

  // ── MINDS_WORKSPACE env var override ─────────────────────────────────────

  test("MINDS_WORKSPACE env var overrides search", () => {
    const repoRoot = freshDir("env-repo");
    initGitRepo(repoRoot);

    const customDir = freshDir("custom-loc");
    const manifestPath = join(customDir, WORKSPACE_MANIFEST_FILENAME);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        orchestratorRepo: "repo-a",
        repos: [{ alias: "repo-a", path: repoRoot }],
      }),
    );

    process.env.MINDS_WORKSPACE = manifestPath;

    const ws = loadWorkspace(repoRoot);

    expect(ws.manifest).not.toBeNull();
    expect(ws.repoPaths.get("repo-a")).toBe(resolve(repoRoot));
  });

  test("MINDS_WORKSPACE pointing to nonexistent file throws", () => {
    const repoRoot = freshDir("env-missing");
    process.env.MINDS_WORKSPACE = "/nonexistent/path/workspace.json";

    expect(() => loadWorkspace(repoRoot)).toThrow("non-existent file");
  });

  // ── Relative paths resolved against manifest dir ─────────────────────────

  test("relative paths resolved against manifest dir, not repoRoot", () => {
    const parentDir = freshDir("rel-parent");
    const repoA = freshDir("rel-parent/a");
    const repoB = freshDir("rel-parent/b");
    initGitRepo(repoA);
    initGitRepo(repoB);

    // Manifest is in parentDir; paths relative to parentDir
    writeManifest(parentDir, {
      version: 1,
      orchestratorRepo: "a",
      repos: [
        { alias: "a", path: "./a" },
        { alias: "b", path: "./b" },
      ],
    });

    // Call loadWorkspace with repoA (child), manifest found in parent
    const ws = loadWorkspace(repoA);

    // Paths should resolve relative to parentDir (manifest location), not repoA
    expect(ws.repoPaths.get("a")).toBe(resolve(parentDir, "a"));
    expect(ws.repoPaths.get("b")).toBe(resolve(parentDir, "b"));
  });

  // ── Error cases ──────────────────────────────────────────────────────────

  test("missing repo path on disk throws with alias and path", () => {
    const repoRoot = freshDir("missing-repo");
    initGitRepo(repoRoot);

    writeManifest(repoRoot, {
      version: 1,
      orchestratorRepo: "main",
      repos: [
        { alias: "main", path: "." },
        { alias: "gone", path: "./nonexistent" },
      ],
    });

    expect(() => loadWorkspace(repoRoot)).toThrow(/gone.*does not exist/);
  });

  test("non-git repo path throws", () => {
    // Create the manifest in a parent dir that is NOT a git repo itself.
    // The "plain" dir exists on disk but is not a git repo.
    const parentDir = freshDir("not-git-parent");
    const repoA = freshDir("not-git-parent/repo-a");
    const plainDir = freshDir("not-git-parent/plain-dir");
    initGitRepo(repoA);
    // plainDir deliberately NOT initialized as git repo

    writeManifest(parentDir, {
      version: 1,
      orchestratorRepo: "repo-a",
      repos: [
        { alias: "repo-a", path: "./repo-a" },
        { alias: "plain", path: "./plain-dir" },
      ],
    });

    expect(() => loadWorkspace(repoA)).toThrow(/plain.*not a git repository/);
  });

  test("invalid JSON throws", () => {
    const repoRoot = freshDir("bad-json");
    writeFileSync(join(repoRoot, WORKSPACE_MANIFEST_FILENAME), "{ invalid }");

    expect(() => loadWorkspace(repoRoot)).toThrow("Failed to parse");
  });

  test("schema validation failure throws", () => {
    const repoRoot = freshDir("bad-schema");
    writeManifest(repoRoot, { version: 99, repos: [] });

    expect(() => loadWorkspace(repoRoot)).toThrow("Invalid workspace manifest");
  });

  // ── Single-repo manifest ────────────────────────────────────────────────

  test("single-repo manifest works correctly", () => {
    const repoRoot = freshDir("single");
    initGitRepo(repoRoot);

    writeManifest(repoRoot, {
      version: 1,
      orchestratorRepo: "mono",
      repos: [{ alias: "mono", path: "." }],
    });

    const ws = loadWorkspace(repoRoot);

    expect(ws.isMultiRepo).toBe(false);
    expect(ws.manifest).not.toBeNull();
    expect(ws.repoPaths.size).toBe(1);
    expect(ws.orchestratorRoot).toBe(resolve(repoRoot, "."));
  });
});
