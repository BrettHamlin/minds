/**
 * implement-multi-repo.test.ts -- Integration tests for the full multi-repo flow (MR-024).
 *
 * Tests the end-to-end multi-repo pipeline: workspace loading, task parsing with repo
 * annotations, wave planning with cross-repo dependencies, registry loading from
 * multiple repos, lint checks with workspace aliases, and cross-repo contract deferral.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { loadWorkspace } from "../../../shared/workspace-loader.ts";
import { loadMultiRepoRegistries } from "../../../shared/registry-loader.ts";
import { parseAndGroupTasks } from "../../lib/task-parser.ts";
import { computeWaves } from "../../lib/wave-planner.ts";
import { parseTasks, lintTasks } from "../../../lib/contracts.ts";
import { buildDroneBrief } from "../../lib/drone-brief.ts";
import { groupDronesByRepo, resolveRepoBaseBranch } from "../implement.ts";
import {
  buildCrossRepoChecks,
  verifyCrossRepoContracts,
} from "../../../lib/supervisor/cross-repo-contracts.ts";
import { resolveMindsDir } from "../../../shared/paths.ts";
import {
  createMultiRepoFixture,
  validateFixture,
  saveAndClearWorkspaceEnv,
  type MultiRepoFixture,
} from "./helpers/multi-repo-setup.ts";
import type { MindDescription } from "../../../mind.ts";
import type { MindInfo } from "../../lib/implement-types.ts";
import type { ContractAnnotation } from "../../../lib/check-contracts-core.ts";

// ── Two-repo multi-repo flow ─────────────────────────────────────────────────

describe("two-repo multi-repo flow (MR-024)", () => {
  let fixture: MultiRepoFixture;
  let restoreEnv: () => void;

  const backendMinds: MindDescription[] = [
    {
      name: "api",
      domain: "backend",
      keywords: ["api", "rest"],
      owns_files: ["src/api/**"],
      capabilities: ["create-endpoints"],
      repo: "backend",
    },
  ];

  const frontendMinds: MindDescription[] = [
    {
      name: "ui",
      domain: "frontend",
      keywords: ["ui", "react"],
      owns_files: ["src/components/**"],
      capabilities: ["build-components"],
      repo: "frontend",
    },
  ];

  beforeEach(() => {
    restoreEnv = saveAndClearWorkspaceEnv();

    fixture = createMultiRepoFixture({
      backendMinds,
      frontendMinds,
      tasksContent: `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create UserResponse endpoint — produces: UserResponse at backend:src/api/user.ts

## @ui Tasks (repo: frontend, owns: src/components/**, depends on: @api)
- [ ] T002 @ui Build user form — consumes: UserResponse from backend:src/api/user.ts`,
      ticketId: "BRE-MR-100",
    });
  });

  afterEach(() => {
    fixture.cleanup();
    restoreEnv();
  });

  test("fixture self-test passes", () => {
    const errors = validateFixture(fixture);
    expect(errors).toEqual([]);
  });

  test("loadWorkspace resolves both repos correctly", () => {
    const ws = loadWorkspace(fixture.frontendRoot);

    expect(ws.isMultiRepo).toBe(true);
    expect(ws.manifest).not.toBeNull();
    expect(ws.orchestratorRoot).toBe(fixture.frontendRoot);
    expect(ws.repoPaths.size).toBe(2);
    expect(ws.repoPaths.get("frontend")).toBe(fixture.frontendRoot);
    expect(ws.repoPaths.get("backend")).toBe(fixture.backendRoot);
  });

  test("MINDS_WORKSPACE env var resolves from secondary repo (wrong CWD)", () => {
    // Simulate running from backend repo with MINDS_WORKSPACE pointing to manifest
    process.env.MINDS_WORKSPACE = fixture.workspaceManifestPath;
    const ws = loadWorkspace(fixture.backendRoot);

    expect(ws.isMultiRepo).toBe(true);
    expect(ws.orchestratorRoot).toBe(fixture.frontendRoot);
  });

  test("loadMultiRepoRegistries loads and tags minds from both repos", () => {
    const ws = loadWorkspace(fixture.frontendRoot);
    const registry = loadMultiRepoRegistries(ws.repoPaths);

    expect(registry).toHaveLength(2);

    const api = registry.find((m) => m.name === "api");
    const ui = registry.find((m) => m.name === "ui");
    expect(api).toBeDefined();
    expect(api!.repo).toBe("backend");
    expect(ui).toBeDefined();
    expect(ui!.repo).toBe("frontend");
  });

  test("task parsing extracts repo annotations", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create endpoint

## @ui Tasks (repo: frontend, owns: src/components/**, depends on: @api)
- [ ] T002 @ui Build form`;

    const groups = parseAndGroupTasks(content);

    expect(groups).toHaveLength(2);
    expect(groups[0].mind).toBe("api");
    expect(groups[0].repo).toBe("backend");
    expect(groups[1].mind).toBe("ui");
    expect(groups[1].repo).toBe("frontend");
  });

  test("wave planning: @api in wave-1, @ui in wave-2 (dependency ordering)", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create endpoint

## @ui Tasks (repo: frontend, owns: src/components/**, depends on: @api)
- [ ] T002 @ui Build form`;

    const groups = parseAndGroupTasks(content);
    const waves = computeWaves(groups);

    expect(waves).toHaveLength(2);
    expect(waves[0].id).toBe("wave-1");
    expect(waves[0].minds).toEqual(["api"]);
    expect(waves[1].id).toBe("wave-2");
    expect(waves[1].minds).toEqual(["ui"]);
  });

  test("lintTasks with workspace aliases passes valid repos", () => {
    const content = `## @api Tasks (repo: backend, owns: src/api/**)
- [ ] T001 @api Create endpoint`;

    const tasks = parseTasks(content);
    const result = lintTasks(tasks, backendMinds, {
      repoAliases: ["backend", "frontend"],
    });

    const repoErrors = result.errors.filter((e) => e.type === "repo_unknown");
    expect(repoErrors).toHaveLength(0);
  });

  test("lintTasks detects unknown repo alias", () => {
    const content = `## @api Tasks (repo: nonexistent, owns: src/api/**)
- [ ] T001 @api Create endpoint`;

    const tasks = parseTasks(content);
    const result = lintTasks(tasks, [], {
      repoAliases: ["backend", "frontend"],
    });

    const repoErrors = result.errors.filter((e) => e.type === "repo_unknown");
    expect(repoErrors).toHaveLength(1);
    expect(repoErrors[0].message).toContain("nonexistent");
  });

  test("resolveRepoBaseBranch returns per-repo defaultBranch", () => {
    const ws = loadWorkspace(fixture.frontendRoot);
    // Default: no per-repo branch override, returns fallback
    expect(resolveRepoBaseBranch("frontend", ws, "main")).toBe("main");
    expect(resolveRepoBaseBranch("backend", ws, "main")).toBe("main");
  });

  test("drone brief includes repo row for multi-repo drones", () => {
    const brief = buildDroneBrief({
      ticketId: "BRE-MR-100",
      mindName: "api",
      waveId: "wave-1",
      tasks: [{ id: "T001", mind: "api", description: "Create endpoint", parallel: false }],
      dependencies: [],
      featureDir: "/tmp/specs/BRE-MR-100",
      repo: "backend",
      testCommand: "npm test",
    });

    expect(brief).toContain("| **Repo** | backend |");
    expect(brief).toContain("npm test");
  });

  test("cross-repo contract checks are built from deferred annotations", () => {
    const deferred: Array<{ mindName: string; repo?: string; annotations: ContractAnnotation[] }> = [
      {
        mindName: "ui",
        repo: "frontend",
        annotations: [
          {
            type: "consumes",
            interfaceName: "UserResponse",
            filePath: "backend:src/api/user.ts",
            mindName: "ui",
          },
        ],
      },
    ];

    const checks = buildCrossRepoChecks(deferred);

    expect(checks).toHaveLength(1);
    expect(checks[0].producerRepo).toBe("backend");
    expect(checks[0].consumerMind).toBe("ui");
    expect(checks[0].consumerRepo).toBe("frontend");
  });

  test("verifyCrossRepoContracts passes when producer file exists with export", () => {
    // Create the producer file in the backend repo
    const apiDir = join(fixture.backendRoot, "src", "api");
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(
      join(apiDir, "user.ts"),
      `export interface UserResponse { id: string; name: string; }\n`,
    );

    const checks = buildCrossRepoChecks([
      {
        mindName: "ui",
        repo: "frontend",
        annotations: [
          {
            type: "consumes",
            interfaceName: "UserResponse",
            filePath: "backend:src/api/user.ts",
            mindName: "ui",
          },
        ],
      },
    ]);

    const ws = loadWorkspace(fixture.frontendRoot);
    const result = verifyCrossRepoContracts(checks, ws.repoPaths, fixture.frontendRoot);

    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("verifyCrossRepoContracts fails when producer file is missing", () => {
    const checks = buildCrossRepoChecks([
      {
        mindName: "ui",
        repo: "frontend",
        annotations: [
          {
            type: "consumes",
            interfaceName: "UserResponse",
            filePath: "backend:src/api/missing.ts",
            mindName: "ui",
          },
        ],
      },
    ]);

    const ws = loadWorkspace(fixture.frontendRoot);
    const result = verifyCrossRepoContracts(checks, ws.repoPaths, fixture.frontendRoot);

    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].reason).toContain("does not exist");
  });

  test("verifyCrossRepoContracts fails when export is missing from file", () => {
    const apiDir = join(fixture.backendRoot, "src", "api");
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(
      join(apiDir, "user.ts"),
      `// No export here\nconst x = 1;\n`,
    );

    const checks = buildCrossRepoChecks([
      {
        mindName: "ui",
        repo: "frontend",
        annotations: [
          {
            type: "consumes",
            interfaceName: "UserResponse",
            filePath: "backend:src/api/user.ts",
            mindName: "ui",
          },
        ],
      },
    ]);

    const ws = loadWorkspace(fixture.frontendRoot);
    const result = verifyCrossRepoContracts(checks, ws.repoPaths, fixture.frontendRoot);

    expect(result.pass).toBe(false);
    expect(result.violations[0].reason).toContain("NOT exported");
  });
});

// ── N > 2 repos ──────────────────────────────────────────────────────────────

describe("N > 2 repos (3-repo workspace) (MR-024)", () => {
  let fixture: MultiRepoFixture;
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = saveAndClearWorkspaceEnv();

    fixture = createMultiRepoFixture({
      repoCount: 3,
      frontendMinds: [
        { name: "ui", domain: "frontend", keywords: ["ui"], owns_files: ["src/**"], capabilities: [] },
      ],
      backendMinds: [
        { name: "api", domain: "backend", keywords: ["api"], owns_files: ["src/**"], capabilities: [] },
      ],
      extraRepoMinds: {
        "repo-3": [
          { name: "shared", domain: "shared", keywords: ["shared"], owns_files: ["src/**"], capabilities: [] },
        ],
      },
    });
  });

  afterEach(() => {
    fixture.cleanup();
    restoreEnv();
  });

  test("workspace loads all 3 repos", () => {
    const ws = loadWorkspace(fixture.frontendRoot);
    expect(ws.isMultiRepo).toBe(true);
    expect(ws.repoPaths.size).toBe(3);
    expect(ws.repoPaths.has("frontend")).toBe(true);
    expect(ws.repoPaths.has("backend")).toBe(true);
    expect(ws.repoPaths.has("repo-3")).toBe(true);
  });

  test("registry loads minds from all 3 repos", () => {
    const ws = loadWorkspace(fixture.frontendRoot);
    const registry = loadMultiRepoRegistries(ws.repoPaths);

    expect(registry).toHaveLength(3);
    expect(registry.map((m) => m.repo).sort()).toEqual(["backend", "frontend", "repo-3"]);
  });

  test("all 3 repos merge independently (groupDronesByRepo)", () => {
    const drones: MindInfo[] = [
      { mindName: "api", repo: "backend", waveId: "wave-1", branch: "b-api", worktree: "/a", paneId: "%0" },
      { mindName: "ui", repo: "frontend", waveId: "wave-1", branch: "b-ui", worktree: "/b", paneId: "%1" },
      { mindName: "shared", repo: "repo-3", waveId: "wave-1", branch: "b-shared", worktree: "/c", paneId: "%2" },
    ];

    const grouped = groupDronesByRepo(drones);
    expect(grouped.size).toBe(3);
    expect(grouped.get("backend")![0].mindName).toBe("api");
    expect(grouped.get("frontend")![0].mindName).toBe("ui");
    expect(grouped.get("repo-3")![0].mindName).toBe("shared");
  });

  test("fixture repos map has all 3 repos", () => {
    expect(fixture.repos.size).toBe(3);
    expect(fixture.repos.has("repo-3")).toBe(true);
    // Verify repo-3 is a real git repo
    const result = Bun.spawnSync(
      ["git", "-C", fixture.repos.get("repo-3")!, "rev-parse", "HEAD"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode).toBe(0);
  });
});
