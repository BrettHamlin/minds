/**
 * implement-workspace.test.ts — Unit tests for workspace integration in implement.ts (MR-008).
 *
 * Since runImplement is a heavy orchestrator (bus, tmux, worktrees), we test
 * the workspace loading and linting wiring as units, not the full orchestrator.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { loadWorkspace } from "../../../shared/workspace-loader.ts";
import { parseTasks, lintTasks } from "../../../lib/contracts.ts";
import { tempDir, initGitRepo } from "./helpers/multi-repo-setup.ts";
import type { MindDescription } from "../../../mind.ts";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("workspace loading in implement context (MR-008)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = tempDir("impl-ws-test");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("single-repo: returns isMultiRepo=false when no manifest", () => {
    initGitRepo(tmpRoot);
    const workspace = loadWorkspace(tmpRoot);
    expect(workspace.isMultiRepo).toBe(false);
    expect(workspace.manifest).toBeNull();
    expect(workspace.orchestratorRoot).toBe(tmpRoot);
  });

  it("multi-repo: loads manifest and resolves paths", () => {
    const backendDir = join(tmpRoot, "backend");
    const frontendDir = join(tmpRoot, "frontend");
    mkdirSync(backendDir, { recursive: true });
    mkdirSync(frontendDir, { recursive: true });
    initGitRepo(backendDir);
    initGitRepo(frontendDir);

    writeFileSync(join(tmpRoot, "minds-workspace.json"), JSON.stringify({
      version: 1,
      orchestratorRepo: "backend",
      repos: [
        { alias: "backend", path: "./backend" },
        { alias: "frontend", path: "./frontend" },
      ],
    }));

    // loadWorkspace searches <repoRoot>/minds-workspace.json first,
    // but we put it at tmpRoot level. Use a child repo as repoRoot
    // and the manifest at parent level (search order #3).
    const workspace = loadWorkspace(backendDir);
    expect(workspace.isMultiRepo).toBe(true);
    expect(workspace.manifest).not.toBeNull();
    expect(workspace.orchestratorRoot).toBe(resolve(tmpRoot, "backend"));
    expect(workspace.repoPaths.size).toBe(2);
    expect(workspace.repoPaths.get("backend")).toBe(resolve(tmpRoot, "backend"));
    expect(workspace.repoPaths.get("frontend")).toBe(resolve(tmpRoot, "frontend"));
  });

  it("orchestratorRoot used for specs/bus/registry resolution", () => {
    const backendDir = join(tmpRoot, "backend");
    const frontendDir = join(tmpRoot, "frontend");
    mkdirSync(backendDir, { recursive: true });
    mkdirSync(frontendDir, { recursive: true });
    initGitRepo(backendDir);
    initGitRepo(frontendDir);

    writeFileSync(join(tmpRoot, "minds-workspace.json"), JSON.stringify({
      version: 1,
      orchestratorRepo: "backend",
      repos: [
        { alias: "backend", path: "./backend" },
        { alias: "frontend", path: "./frontend" },
      ],
    }));

    const workspace = loadWorkspace(backendDir);
    // orchestratorRoot should be the backend repo, NOT the frontend repo
    expect(workspace.orchestratorRoot).toBe(resolve(tmpRoot, "backend"));
    // Bus, specs, registry should all go to orchestratorRoot
    // (This is wired in implement.ts — here we verify the value is correct)
  });
});

describe("lintTasks with workspace aliases (MR-008)", () => {
  const emptyRegistry: MindDescription[] = [];

  it("passes workspace aliases to lintTasks in multi-repo mode", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const lintWorkspace = { repoAliases: ["backend", "frontend"] };
    const result = lintTasks(tasks, emptyRegistry, lintWorkspace);
    // Should not have repo_unknown since "backend" is in aliases
    const repoErrors = result.errors.filter(e => e.type === "repo_unknown");
    expect(repoErrors).toHaveLength(0);
  });

  it("detects unknown repo alias", () => {
    const content = `## @api Tasks (repo: nonexistent, owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const lintWorkspace = { repoAliases: ["backend", "frontend"] };
    const result = lintTasks(tasks, emptyRegistry, lintWorkspace);
    const repoErrors = result.errors.filter(e => e.type === "repo_unknown");
    expect(repoErrors).toHaveLength(1);
  });

  it("skips workspace lint when no workspace (single-repo)", () => {
    const content = `## @api Tasks (repo: whatever, owns: src/api/**)
- [ ] T001 @api Create endpoint`;
    const tasks = parseTasks(content);
    const result = lintTasks(tasks, emptyRegistry); // no workspace
    const repoErrors = result.errors.filter(e => e.type === "repo_unknown");
    expect(repoErrors).toHaveLength(0);
  });
});
