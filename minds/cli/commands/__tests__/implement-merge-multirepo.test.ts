/**
 * implement-merge-multirepo.test.ts — Tests for per-repo grouped merge (MR-017).
 *
 * Tests the merge grouping, checkout, and event payload logic.
 * Uses real git repos for reliable merge testing.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Capture published events ────────────────────────────────────────────────

type PublishCall = { busUrl: string; channel: string; type: string; payload: unknown };
const publishCalls: PublishCall[] = [];

mock.module("../../../../minds/transport/minds-publish.ts", () => ({
  mindsPublish: async (busUrl: string, channel: string, type: string, payload: unknown) => {
    publishCalls.push({ busUrl, channel, type, payload });
  },
  resolveBusUrl: () => undefined,
}));

const { mergeDrone } = await import("../../../lib/merge-drone.ts");
import { groupDronesByRepo, resolveRepoBaseBranch } from "../implement.ts";
import type { ResolvedWorkspace } from "../../../shared/workspace-loader.ts";
import type { MindInfo } from "../../lib/implement-types.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tempDir(): string {
  const dir = join(tmpdir(), `merge-mr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function runGit(
  cwd: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function initRepo(repoPath: string, branch = "main"): Promise<void> {
  mkdirSync(repoPath, { recursive: true });
  await runGit(repoPath, "init", "-b", branch);
  await runGit(repoPath, "config", "user.email", "test@test.com");
  await runGit(repoPath, "config", "user.name", "Test");
  writeFileSync(join(repoPath, "README.md"), "init");
  await runGit(repoPath, "add", ".");
  await runGit(repoPath, "commit", "-m", "initial");
}

async function createWorktreeWithChanges(
  mainRepo: string,
  branchName: string,
  fileName: string,
  content: string,
): Promise<string> {
  const worktreePath = join(mainRepo, "..", `wt-${branchName.replace(/\//g, "-")}`);
  await runGit(mainRepo, "worktree", "add", worktreePath, "-b", branchName);
  writeFileSync(join(worktreePath, fileName), content);
  await runGit(worktreePath, "add", ".");
  await runGit(worktreePath, "commit", "-m", `feat: ${fileName}`);
  return worktreePath;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("mergeDrone — repo field in events (MR-017)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = tempDir();
    publishCalls.length = 0;
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("merge events include repo field when provided", async () => {
    const repoPath = join(tmpRoot, "backend");
    await initRepo(repoPath);
    const worktree = await createWorktreeWithChanges(repoPath, "minds/BRE-100-api", "api.ts", "export const api = true;");

    const result = await mergeDrone({
      worktreePath: worktree,
      targetBranch: "main",
      repoRoot: repoPath,
      busUrl: "http://localhost:9999",
      channel: "minds-BRE-100",
      waveId: "wave-1",
      mindName: "api",
      repo: "backend",
    });

    expect(result.success).toBe(true);

    const mergingEvent = publishCalls.find(c => c.type === "DRONE_MERGING");
    const mergedEvent = publishCalls.find(c => c.type === "DRONE_MERGED");
    expect(mergingEvent).toBeDefined();
    expect(mergedEvent).toBeDefined();
    expect((mergingEvent!.payload as any).repo).toBe("backend");
    expect((mergedEvent!.payload as any).repo).toBe("backend");
  });

  test("merge events have undefined repo when not provided", async () => {
    const repoPath = join(tmpRoot, "solo");
    await initRepo(repoPath);
    const worktree = await createWorktreeWithChanges(repoPath, "minds/BRE-200-core", "core.ts", "export const core = true;");

    const result = await mergeDrone({
      worktreePath: worktree,
      targetBranch: "main",
      repoRoot: repoPath,
      busUrl: "http://localhost:9999",
      channel: "minds-BRE-200",
      waveId: "wave-1",
      mindName: "core",
    });

    expect(result.success).toBe(true);

    const mergingEvent = publishCalls.find(c => c.type === "DRONE_MERGING");
    expect(mergingEvent).toBeDefined();
    expect((mergingEvent!.payload as any).repo).toBeUndefined();
  });

  test("single-repo merge still works (backward compat)", async () => {
    const repoPath = join(tmpRoot, "solo");
    await initRepo(repoPath);
    const worktree = await createWorktreeWithChanges(repoPath, "minds/BRE-300-ui", "ui.ts", "export const ui = true;");

    const result = await mergeDrone({
      worktreePath: worktree,
      targetBranch: "main",
      repoRoot: repoPath,
    });

    expect(result.success).toBe(true);
    expect(result.branch).toBe("minds/BRE-300-ui");
  });
});

describe("groupDronesByRepo (MR-017)", () => {
  const makeDrone = (mindName: string, repo?: string): MindInfo => ({
    mindName,
    repo,
    waveId: "wave-1",
    branch: `minds/BRE-100-${mindName}`,
    worktree: `/tmp/${mindName}`,
    paneId: "%0",
  });

  test("drones group by repo key", () => {
    const drones = [
      makeDrone("api", "backend"),
      makeDrone("ui", "frontend"),
      makeDrone("auth", "backend"),
      makeDrone("core"),
    ];

    const result = groupDronesByRepo(drones);

    expect(result.size).toBe(3);
    expect(result.get("backend")).toHaveLength(2);
    expect(result.get("frontend")).toHaveLength(1);
    expect(result.get("__default__")).toHaveLength(1);
  });

  test("mixed repos in one wave get independent groups", () => {
    const drones = [
      makeDrone("a", "r1"),
      makeDrone("b", "r2"),
      makeDrone("c", "r1"),
      makeDrone("d", "r3"),
    ];

    const result = groupDronesByRepo(drones);

    expect(result.size).toBe(3);
    expect(result.get("r1")!.map(d => d.mindName)).toEqual(["a", "c"]);
    expect(result.get("r2")!.map(d => d.mindName)).toEqual(["b"]);
    expect(result.get("r3")!.map(d => d.mindName)).toEqual(["d"]);
  });

  test("all same repo produces single group", () => {
    const drones = [makeDrone("a", "mono"), makeDrone("b", "mono")];
    const result = groupDronesByRepo(drones);
    expect(result.size).toBe(1);
    expect(result.get("mono")).toHaveLength(2);
  });
});

describe("resolveRepoBaseBranch (MR-017)", () => {
  const makeWorkspace = (repos: Array<{ alias: string; path: string; defaultBranch?: string }>): ResolvedWorkspace => ({
    manifest: { repos: repos as any },
    repoPaths: new Map(repos.map(r => [r.alias, r.path])),
    orchestratorRoot: "/orchestrator",
    isMultiRepo: repos.length > 1,
  });

  test("__default__ returns fallback branch", () => {
    const ws = makeWorkspace([{ alias: "backend", path: "../backend", defaultBranch: "develop" }]);
    expect(resolveRepoBaseBranch("__default__", ws, "main")).toBe("main");
  });

  test("known repo returns its defaultBranch", () => {
    const ws = makeWorkspace([{ alias: "backend", path: "../backend", defaultBranch: "develop" }]);
    expect(resolveRepoBaseBranch("backend", ws, "main")).toBe("develop");
  });

  test("repo without defaultBranch returns fallback", () => {
    const ws = makeWorkspace([{ alias: "frontend", path: "../frontend" }]);
    expect(resolveRepoBaseBranch("frontend", ws, "main")).toBe("main");
  });

  test("null manifest returns fallback", () => {
    const ws: ResolvedWorkspace = { manifest: null, repoPaths: new Map(), orchestratorRoot: "/", isMultiRepo: false };
    expect(resolveRepoBaseBranch("anything", ws, "main")).toBe("main");
  });
});
