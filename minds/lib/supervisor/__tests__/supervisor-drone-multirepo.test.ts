/**
 * supervisor-drone-multirepo.test.ts — Tests for multi-repo flag passing in spawnDrone (MR-012).
 *
 * Verifies:
 * - Single-repo config produces no multi-repo flags
 * - Multi-repo config with all fields produces all four flags
 * - mindRepoRoot === repoRoot does NOT produce --orchestrator-root
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tempDir } from "../../../cli/commands/__tests__/helpers/multi-repo-setup.ts";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("spawnDrone — multi-repo flag passing (MR-012)", () => {
  let tmpRoot: string;
  let capturedArgs: string[] | null = null;
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    tmpRoot = tempDir();
    capturedArgs = null;
    originalSpawn = Bun.spawn;

    // Mock Bun.spawn to capture args and return fake output
    // @ts-expect-error — Bun.spawn is read-only but we need to mock it
    Bun.spawn = (args: string[], opts?: any) => {
      capturedArgs = args as string[];
      const jsonOutput = JSON.stringify({
        drone_pane: "%99",
        worktree: "/tmp/fake-worktree",
        branch: "minds/TEST-123-api",
      });
      return {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(jsonOutput));
            controller.close();
          },
        }),
        stderr: new ReadableStream({
          start(controller) { controller.close(); },
        }),
        exited: Promise.resolve(0),
        pid: 12345,
        kill: () => {},
      } as any;
    };
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    // @ts-expect-error — restoring original
    Bun.spawn = originalSpawn;
  });

  test("single-repo config produces no multi-repo flags", async () => {
    // Create state dir for brief file
    const stateDir = join(tmpRoot, ".minds", "state");
    mkdirSync(stateDir, { recursive: true });

    const { spawnDrone } = await import("../supervisor-drone.ts");

    await spawnDrone({
      repoRoot: tmpRoot,
      mindsSourceDir: join(tmpRoot, "minds"),
      mindName: "api",
      ticketId: "TEST-123",
      callerPane: "%0",
      busUrl: "http://localhost:8888",
      channel: "minds-TEST-123",
      waveId: "wave-1",
      baseBranch: "main",
      tasks: [],
      dependencies: [],
      featureDir: "specs/TEST-123",
      ownsFiles: ["src/api/**"],
      maxIterations: 3,
    } as any, "# Brief content");

    expect(capturedArgs).not.toBeNull();
    const args = capturedArgs!;
    expect(args).not.toContain("--repo-root");
    expect(args).not.toContain("--repo-alias");
    expect(args).not.toContain("--install-cmd");
    expect(args).not.toContain("--orchestrator-root");
  });

  test("multi-repo config with all fields produces all four flags", async () => {
    const stateDir = join(tmpRoot, ".minds", "state");
    mkdirSync(stateDir, { recursive: true });

    const { spawnDrone } = await import("../supervisor-drone.ts");

    await spawnDrone({
      repoRoot: tmpRoot,
      mindsSourceDir: join(tmpRoot, "minds"),
      mindName: "api",
      ticketId: "TEST-123",
      callerPane: "%0",
      busUrl: "http://localhost:8888",
      channel: "minds-TEST-123",
      waveId: "wave-1",
      baseBranch: "main",
      tasks: [],
      dependencies: [],
      featureDir: "specs/TEST-123",
      ownsFiles: ["src/api/**"],
      maxIterations: 3,
      // Multi-repo fields
      repo: "backend",
      mindRepoRoot: "/repos/backend",
      installCommand: "npm install",
    } as any, "# Brief content");

    expect(capturedArgs).not.toBeNull();
    const args = capturedArgs!;

    // --repo-root
    const repoRootIdx = args.indexOf("--repo-root");
    expect(repoRootIdx).toBeGreaterThan(-1);
    expect(args[repoRootIdx + 1]).toBe("/repos/backend");

    // --repo-alias
    const aliasIdx = args.indexOf("--repo-alias");
    expect(aliasIdx).toBeGreaterThan(-1);
    expect(args[aliasIdx + 1]).toBe("backend");

    // --install-cmd
    const installIdx = args.indexOf("--install-cmd");
    expect(installIdx).toBeGreaterThan(-1);
    expect(args[installIdx + 1]).toBe("npm install");

    // --orchestrator-root (mindRepoRoot !== repoRoot)
    const orchIdx = args.indexOf("--orchestrator-root");
    expect(orchIdx).toBeGreaterThan(-1);
    expect(args[orchIdx + 1]).toBe(tmpRoot);
  });

  test("mindRepoRoot === repoRoot does NOT produce --orchestrator-root", async () => {
    const stateDir = join(tmpRoot, ".minds", "state");
    mkdirSync(stateDir, { recursive: true });

    const { spawnDrone } = await import("../supervisor-drone.ts");

    await spawnDrone({
      repoRoot: tmpRoot,
      mindsSourceDir: join(tmpRoot, "minds"),
      mindName: "api",
      ticketId: "TEST-123",
      callerPane: "%0",
      busUrl: "http://localhost:8888",
      channel: "minds-TEST-123",
      waveId: "wave-1",
      baseBranch: "main",
      tasks: [],
      dependencies: [],
      featureDir: "specs/TEST-123",
      ownsFiles: ["src/api/**"],
      maxIterations: 3,
      // Multi-repo but same root
      repo: "solo",
      mindRepoRoot: tmpRoot, // same as repoRoot
    } as any, "# Brief content");

    expect(capturedArgs).not.toBeNull();
    const args = capturedArgs!;

    // Should have --repo-root and --repo-alias
    expect(args).toContain("--repo-root");
    expect(args).toContain("--repo-alias");

    // Should NOT have --orchestrator-root (same root)
    expect(args).not.toContain("--orchestrator-root");
  });
});
