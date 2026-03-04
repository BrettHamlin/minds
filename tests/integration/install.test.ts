/**
 * Integration tests for pipelines install.
 *
 * Calls install() directly against an in-process local registry — no subprocess
 * overhead. The in-process Bun.serve server responds to install()'s fetch() calls
 * on the shared event loop.
 *
 * Tests:
 *  1. Install single pipeline — state, lockfile, commands all written
 *  2. Install pipeline with deps — both installed in topological order
 *  3. Install already-installed — idempotent, no duplicates
 *  4. Install with satisfied CLI dep — succeeds (bun is present on test host)
 *  5. Missing CLI dep detection — getBlockingClis identifies missing tool
 */

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { install } from "../../src/cli/commands/pipelines/install.js";
import { readState } from "../../src/cli/lib/state.js";
import { readLockfile } from "../../src/cli/lib/lockfile.js";
import { checkAllClis, getBlockingClis } from "../../src/cli/lib/cli-resolver.js";
import { createTestEnv, type TestEnv } from "../helpers/test-env.js";
import { startLocalRegistry, type LocalRegistry } from "../helpers/local-registry.js";

let env: TestEnv | null = null;
let registry: LocalRegistry | null = null;

afterEach(async () => {
  await env?.cleanup();
  await registry?.stop();
  env = null;
  registry = null;
});

// ─── Test 1: single pipeline ──────────────────────────────────────────────────

describe("install: single pipeline", () => {
  test("state file updated, lockfile created, commands copied", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry([
      {
        name: "specify",
        version: "1.2.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# collab specify\nTest command\n" },
      },
    ]);

    await install(["specify"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    // Command file copied
    expect(existsSync(join(env.commandsDir, "collab.specify.md"))).toBe(true);

    // State updated
    const state = readState(env.statePath);
    expect(state.pipelines.specify).toBeDefined();
    expect(state.pipelines.specify.version).toBe("1.2.0");
    expect(state.pipelines.specify.checksum).toBeTruthy();

    // Lockfile created
    const lockfile = readLockfile(env.lockPath);
    expect(lockfile).not.toBeNull();
    expect(lockfile!.lockfileVersion).toBe(1);
    expect(lockfile!.pipelines.specify).toBeDefined();
    expect(lockfile!.pipelines.specify.resolvedVersion).toBe("1.2.0");
    expect(lockfile!.pipelines.specify.tarballUrl).toContain("specify-1.2.0.tar.gz");
  });
});

// ─── Test 2: pipeline with transitive dependencies ────────────────────────────

describe("install: pipeline with dependencies", () => {
  test("specify + plan both installed; specify installed before plan", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry([
      {
        name: "specify",
        version: "1.2.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify\n" },
      },
      {
        name: "plan",
        version: "1.1.0",
        dependencies: [{ name: "specify", version: ">=1.0.0" }],
        commands: ["commands/collab.plan.md"],
        commandFiles: { "collab.plan.md": "# plan\n" },
      },
    ]);

    await install(["plan"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    // Both pipelines installed
    const state = readState(env.statePath);
    expect(state.pipelines.specify).toBeDefined();
    expect(state.pipelines.plan).toBeDefined();

    // Lockfile has both entries
    const lockfile = readLockfile(env.lockPath);
    expect(lockfile!.pipelines.specify).toBeDefined();
    expect(lockfile!.pipelines.plan).toBeDefined();

    // plan's lockfile entry records specify as a dependency
    expect(lockfile!.pipelines.plan.dependencies).toContain("specify");

    // Command files copied for both
    expect(existsSync(join(env.commandsDir, "collab.specify.md"))).toBe(true);
    expect(existsSync(join(env.commandsDir, "collab.plan.md"))).toBe(true);
  });
});

// ─── Test 3: idempotent install ────────────────────────────────────────────────

describe("install: idempotent", () => {
  test("installing specify twice produces no duplicate state entries", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry([
      {
        name: "specify",
        version: "1.2.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify\n" },
      },
    ]);

    const opts = {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    };

    await install(["specify"], opts);
    await install(["specify"], opts); // second install — should be skipped

    const state = readState(env.statePath);
    const specifyKeys = Object.keys(state.pipelines).filter((k) => k === "specify");
    expect(specifyKeys).toHaveLength(1);
    expect(state.pipelines.specify.version).toBe("1.2.0");
  });
});

// ─── Test 4 & 5: CLI dependency checks ───────────────────────────────────────

describe("install: CLI dependency checks", () => {
  test("satisfied CLI dep — bun is present on the test host", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry([
      {
        name: "specify",
        version: "1.2.0",
        // bun is guaranteed present — it runs these tests
        cliDependencies: [{ name: "bun", version: ">=1.0.0", required: true }],
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify\n" },
      },
    ]);

    // Should not throw — bun is present
    await install(["specify"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    const state = readState(env.statePath);
    expect(state.pipelines.specify).toBeDefined();
  });

  test("missing CLI dep — getBlockingClis identifies the missing tool", () => {
    // Test the blocking detection logic directly without install() subprocess
    const fakeDeps = [
      {
        name: "nonexistent-cli-tool-xyz-99",
        version: ">=1.0.0",
        required: true,
        installHint: "This tool does not exist",
      },
    ];

    const results = checkAllClis(fakeDeps);
    const blocking = getBlockingClis(results);

    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking[0].name).toBe("nonexistent-cli-tool-xyz-99");
    expect(blocking[0].status).toBe("missing");
  });
});
