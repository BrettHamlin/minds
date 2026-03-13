/**
 * implement-single-repo-compat.test.ts -- Verify single-repo backward compatibility (MR-024).
 *
 * When no workspace manifest exists, the system must behave exactly as before
 * multi-repo support was added: isMultiRepo=false, no repo tags, no cross-repo checks.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadWorkspace } from "../../../shared/workspace-loader.ts";
import { parseAndGroupTasks } from "../../lib/task-parser.ts";
import { computeWaves } from "../../lib/wave-planner.ts";
import { parseTasks, lintTasks } from "../../../lib/contracts.ts";
import { buildDroneBrief } from "../../lib/drone-brief.ts";
import { groupDronesByRepo, resolveRepoBaseBranch } from "../implement.ts";
import { tempDir, initGitRepo, saveAndClearWorkspaceEnv } from "./helpers/multi-repo-setup.ts";
import type { MindInfo } from "../../lib/implement-types.ts";
import type { ResolvedWorkspace } from "../../../shared/workspace-loader.ts";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("single-repo backward compatibility (MR-024)", () => {
  let tmpRoot: string;
  let restoreEnv: () => void;

  beforeEach(() => {
    tmpRoot = tempDir("sr-compat");
    initGitRepo(tmpRoot);
    restoreEnv = saveAndClearWorkspaceEnv();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    restoreEnv();
  });

  test("no manifest -> isMultiRepo=false with single-repo fallback", () => {
    const ws = loadWorkspace(tmpRoot);
    expect(ws.isMultiRepo).toBe(false);
    expect(ws.manifest).toBeNull();
    expect(ws.orchestratorRoot).toBe(tmpRoot);
    expect(ws.repoPaths.size).toBe(0);
  });

  test("tasks parse without repo fields in single-repo mode", () => {
    const content = `## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create endpoint
- [ ] T002 @api Add validation

## @ui Tasks (owns: src/ui/**, depends on: @api)
- [ ] T003 @ui Build form component`;

    const groups = parseAndGroupTasks(content);

    expect(groups).toHaveLength(2);
    // No repo field on groups in single-repo tasks
    expect(groups[0].repo).toBeUndefined();
    expect(groups[1].repo).toBeUndefined();
  });

  test("wave planning works without repo annotations", () => {
    const content = `## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create endpoint

## @ui Tasks (owns: src/ui/**, depends on: @api)
- [ ] T002 @ui Build form`;

    const groups = parseAndGroupTasks(content);
    const waves = computeWaves(groups);

    expect(waves).toHaveLength(2);
    expect(waves[0].minds).toEqual(["api"]);
    expect(waves[1].minds).toEqual(["ui"]);
  });

  test("lintTasks passes without workspace (no repo lint checks)", () => {
    const content = `## @api Tasks (owns: src/api/**)
- [ ] T001 @api Create endpoint`;

    const tasks = parseTasks(content);
    // No workspace param -> no repo_unknown checks
    const result = lintTasks(tasks, []);
    const repoErrors = result.errors.filter(
      (e) => e.type === "repo_unknown" || e.type === "missing_repo_multirepo",
    );
    expect(repoErrors).toHaveLength(0);
  });

  test("all drones have repo=undefined in single-repo mode", () => {
    const drones: MindInfo[] = [
      { mindName: "api", waveId: "wave-1", branch: "minds/BRE-1-api", worktree: "/tmp/api", paneId: "%0" },
      { mindName: "ui", waveId: "wave-1", branch: "minds/BRE-1-ui", worktree: "/tmp/ui", paneId: "%1" },
    ];

    // All should have no repo field
    for (const d of drones) {
      expect(d.repo).toBeUndefined();
    }

    // groupDronesByRepo places all into __default__
    const grouped = groupDronesByRepo(drones);
    expect(grouped.size).toBe(1);
    expect(grouped.has("__default__")).toBe(true);
    expect(grouped.get("__default__")).toHaveLength(2);
  });

  test("resolveRepoBaseBranch returns fallback when no manifest", () => {
    const ws: ResolvedWorkspace = {
      manifest: null,
      repoPaths: new Map(),
      orchestratorRoot: tmpRoot,
      isMultiRepo: false,
    };

    expect(resolveRepoBaseBranch("__default__", ws, "main")).toBe("main");
    expect(resolveRepoBaseBranch("anything", ws, "dev")).toBe("dev");
  });

  test("drone brief has no repo row in single-repo mode", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-100",
      mindName: "api",
      waveId: "wave-1",
      tasks: [{ id: "T001", mind: "api", description: "Create endpoint", parallel: false }],
      dependencies: [],
      featureDir: "/tmp/specs/BRE-100",
    });

    // No repo row in the brief table
    expect(brief).not.toContain("| **Repo**");
  });

  test("single-repo manifest (degenerate case) behaves like single-repo", () => {
    // A manifest with exactly 1 repo
    const manifestDir = join(tmpRoot, "..");
    writeFileSync(
      join(manifestDir, "minds-workspace.json"),
      JSON.stringify({
        version: 1,
        orchestratorRepo: "solo",
        repos: [{ alias: "solo", path: `./${tmpRoot.split("/").pop()}` }],
      }),
    );

    const ws = loadWorkspace(tmpRoot);
    // Single repo in manifest -> isMultiRepo=false
    expect(ws.isMultiRepo).toBe(false);
    expect(ws.manifest).not.toBeNull();
    expect(ws.repoPaths.size).toBe(1);
    expect(ws.orchestratorRoot).toBe(tmpRoot);

    // Clean up the parent manifest
    rmSync(join(manifestDir, "minds-workspace.json"), { force: true });
  });
});
