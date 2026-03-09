/**
 * merge-drone-events.test.ts — Verify DRONE_MERGING and DRONE_MERGED event
 * emission in mergeDrone() when bus options are provided.
 *
 * Uses real git repos (like merge-drone.test.ts) for reliable merge testing.
 * mindsPublish is mocked to capture publish calls without a real bus.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ─── Capture published events ─────────────────────────────────────────────────

type PublishCall = { busUrl: string; channel: string; type: string; payload: unknown };
const publishCalls: PublishCall[] = [];

mock.module("../../transport/minds-publish.ts", () => ({
  mindsPublish: async (busUrl: string, channel: string, type: string, payload: unknown) => {
    publishCalls.push({ busUrl, channel, type, payload });
  },
  resolveBusUrl: () => undefined,
}));

// ─── Import after mock registration ──────────────────────────────────────────

const { mergeDrone } = await import("../merge-drone.ts");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TMP = join(tmpdir(), "merge-drone-events-tests");

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

async function initRepo(repoPath: string, branch = "minds/main"): Promise<void> {
  mkdirSync(repoPath, { recursive: true });
  await runGit(repoPath, "init", "-b", branch);
  await runGit(repoPath, "config", "user.email", "test@test.com");
  await runGit(repoPath, "config", "user.name", "Test");
  writeFileSync(join(repoPath, "README.md"), "# Test\n");
  await runGit(repoPath, "add", "-A");
  await runGit(repoPath, "commit", "-m", "init");
}

async function addWorktree(repoPath: string, worktreePath: string, branch: string): Promise<void> {
  await runGit(repoPath, "worktree", "add", "-b", branch, worktreePath);
}

// ─── Bus options fixture ──────────────────────────────────────────────────────

const BUS_OPTS = {
  busUrl: "http://localhost:7777",
  channel: "minds-TEST-001",
  waveId: "wave-9999999",
  mindName: "signals",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  publishCalls.length = 0;
});

describe("mergeDrone — event emission", () => {
  it("publishes DRONE_MERGING before merge and DRONE_MERGED after success", async () => {
    const repoPath = join(TMP, "repo-events-success");
    const worktreePath = join(TMP, "wt-events-success");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-455-signals");

    writeFileSync(join(worktreePath, "signal.ts"), "export const s = 1;\n");

    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
      ...BUS_OPTS,
    });

    expect(result.success).toBe(true);

    const merging = publishCalls.find((c) => c.type === "DRONE_MERGING");
    const merged = publishCalls.find((c) => c.type === "DRONE_MERGED");

    expect(merging).toBeDefined();
    expect(merged).toBeDefined();

    // DRONE_MERGING must appear before DRONE_MERGED
    const mergingIdx = publishCalls.indexOf(merging!);
    const mergedIdx = publishCalls.indexOf(merged!);
    expect(mergingIdx).toBeLessThan(mergedIdx);
  });

  it("DRONE_MERGING payload contains waveId and mindName", async () => {
    const repoPath = join(TMP, "repo-merging-payload");
    const worktreePath = join(TMP, "wt-merging-payload");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-455-signals");

    writeFileSync(join(worktreePath, "a.ts"), "export {};\n");

    await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
      ...BUS_OPTS,
    });

    const merging = publishCalls.find((c) => c.type === "DRONE_MERGING");
    expect(merging).toBeDefined();
    const p = merging!.payload as Record<string, unknown>;
    expect(p.waveId).toBe(BUS_OPTS.waveId);
    expect(p.mindName).toBe(BUS_OPTS.mindName);
    expect(merging!.channel).toBe(BUS_OPTS.channel);
    expect(merging!.busUrl).toBe(BUS_OPTS.busUrl);
  });

  it("DRONE_MERGED payload contains waveId and mindName", async () => {
    const repoPath = join(TMP, "repo-merged-payload");
    const worktreePath = join(TMP, "wt-merged-payload");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-455-signals");

    writeFileSync(join(worktreePath, "b.ts"), "export {};\n");

    await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
      ...BUS_OPTS,
    });

    const merged = publishCalls.find((c) => c.type === "DRONE_MERGED");
    expect(merged).toBeDefined();
    const p = merged!.payload as Record<string, unknown>;
    expect(p.waveId).toBe(BUS_OPTS.waveId);
    expect(p.mindName).toBe(BUS_OPTS.mindName);
  });

  it("does not publish DRONE_MERGED when merge fails due to conflicts", async () => {
    const repoPath = join(TMP, "repo-conflict-events");
    const worktreePath = join(TMP, "wt-conflict-events");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-455-signals");

    // Both drone and main modify the same file divergently
    writeFileSync(join(worktreePath, "shared.ts"), "export const v = 'drone';\n");
    await runGit(worktreePath, "add", "-A");
    await runGit(worktreePath, "commit", "-m", "drone version");

    writeFileSync(join(repoPath, "shared.ts"), "export const v = 'main';\n");
    await runGit(repoPath, "add", "-A");
    await runGit(repoPath, "commit", "-m", "main version");

    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
      ...BUS_OPTS,
    });

    expect(result.success).toBe(false);
    expect(result.hasConflicts).toBe(true);

    // DRONE_MERGING is published (we started the merge)
    const merging = publishCalls.find((c) => c.type === "DRONE_MERGING");
    expect(merging).toBeDefined();

    // DRONE_MERGED must NOT be published on failure
    const merged = publishCalls.find((c) => c.type === "DRONE_MERGED");
    expect(merged).toBeUndefined();
  });

  it("does not publish any bus events when busUrl is omitted", async () => {
    const repoPath = join(TMP, "repo-no-bus");
    const worktreePath = join(TMP, "wt-no-bus");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-455-signals");

    writeFileSync(join(worktreePath, "c.ts"), "export {};\n");

    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
      // No busUrl — bus options absent
    });

    expect(result.success).toBe(true);
    expect(publishCalls).toHaveLength(0);
  });
});
