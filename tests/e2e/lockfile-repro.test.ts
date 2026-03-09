/**
 * E2E test: lockfile reproducibility
 *
 * Steps:
 *  1. Create env A — install specify; lockfile records version + checksum
 *  2. Create env B (fresh) — copy lockfile from env A
 *  3. Install specify in env B against the same registry
 *  4. Verify: env B lockfile has the same resolved version and tarball URL as env A
 *  5. Verify: registry serving a higher version does NOT override the already-installed
 *     state when the same version is requested (deterministic install)
 *
 * Uses direct function calls (no subprocess) — success path only.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { copyFileSync } from "node:fs";
import { install } from "../../minds/cli/commands/pipelines/install.js";
import { readLockfile } from "../../minds/cli/lib/lockfile.js";
import { readState } from "../../minds/cli/lib/state.js";
import { createTestEnv, type TestEnv } from "../helpers/test-env.js";
import { startLocalRegistry, type LocalRegistry } from "../helpers/local-registry.js";

let envA: TestEnv | null = null;
let envB: TestEnv | null = null;
let registry: LocalRegistry | null = null;

afterEach(async () => {
  await envA?.cleanup();
  await envB?.cleanup();
  await registry?.stop();
  envA = null;
  envB = null;
  registry = null;
});

// ─── Test 1: lockfile matches across two identical installs ───────────────────

describe("lockfile-repro: identical installs produce identical lockfiles", () => {
  test("env A and env B installed from same registry have matching lockfile entries", async () => {
    envA = await createTestEnv();
    envB = await createTestEnv();

    registry = await startLocalRegistry([
      {
        name: "specify",
        version: "1.2.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify\n" },
      },
    ]);

    const opts = (env: NonNullable<typeof envA>) => ({
      registryUrl: registry!.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    // Install in env A
    await install(["specify"], opts(envA));

    // Install in env B
    await install(["specify"], opts(envB));

    const lockA = readLockfile(envA.lockPath)!;
    const lockB = readLockfile(envB.lockPath)!;

    // Both must resolve to the same version
    expect(lockA.pipelines.specify.resolvedVersion).toBe("1.2.0");
    expect(lockB.pipelines.specify.resolvedVersion).toBe("1.2.0");

    // Both must reference the same tarball URL
    expect(lockA.pipelines.specify.tarballUrl).toBe(lockB.pipelines.specify.tarballUrl);

    // Both must record the same checksum (same bytes downloaded from same URL)
    expect(lockA.pipelines.specify.checksum).toBe(lockB.pipelines.specify.checksum);
  });
});

// ─── Test 2: copied lockfile preserves version info ───────────────────────────

describe("lockfile-repro: copied lockfile preserves recorded versions", () => {
  test("lockfile from env A copied to env B retains exact version + checksum", async () => {
    envA = await createTestEnv();
    envB = await createTestEnv();

    registry = await startLocalRegistry([
      {
        name: "specify",
        version: "1.2.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify\n" },
      },
    ]);

    // Install in env A
    await install(["specify"], {
      registryUrl: registry.registryUrl,
      statePath: envA.statePath,
      lockPath: envA.lockPath,
      installDir: envA.installDir,
      commandsDir: envA.commandsDir,
    });

    const lockA = readLockfile(envA.lockPath)!;

    // Copy env A's lockfile into env B
    copyFileSync(envA.lockPath, envB.lockPath);

    // Verify env B's lockfile is readable and has the same data
    const lockB = readLockfile(envB.lockPath)!;
    expect(lockB.lockfileVersion).toBe(1);
    expect(lockB.pipelines.specify.resolvedVersion).toBe(lockA.pipelines.specify.resolvedVersion);
    expect(lockB.pipelines.specify.checksum).toBe(lockA.pipelines.specify.checksum);
    expect(lockB.pipelines.specify.tarballUrl).toBe(lockA.pipelines.specify.tarballUrl);
  });
});

// ─── Test 3: re-install with newer registry is blocked by already-installed ───

describe("lockfile-repro: already-installed version is preserved on re-install", () => {
  test("installing again from a registry with newer version skips (idempotent)", async () => {
    envA = await createTestEnv();

    // Start with v1.0.0 registry
    registry = await startLocalRegistry([
      {
        name: "specify",
        version: "1.0.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify v1\n" },
      },
    ]);

    await install(["specify"], {
      registryUrl: registry.registryUrl,
      statePath: envA.statePath,
      lockPath: envA.lockPath,
      installDir: envA.installDir,
      commandsDir: envA.commandsDir,
    });

    // Verify v1.0.0 installed
    const stateAfterFirst = readState(envA.statePath);
    expect(stateAfterFirst.pipelines.specify.version).toBe("1.0.0");

    // Stop v1.0.0 registry, start v1.2.0 registry
    await registry.stop();
    registry = await startLocalRegistry([
      {
        name: "specify",
        version: "1.2.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify v1.2\n" },
      },
    ]);

    // Re-install without --force: already-installed check skips it
    await install(["specify"], {
      registryUrl: registry.registryUrl,
      statePath: envA.statePath,
      lockPath: envA.lockPath,
      installDir: envA.installDir,
      commandsDir: envA.commandsDir,
    });

    // State version unchanged — idempotent (v1.0.0 was already installed)
    const stateAfterSecond = readState(envA.statePath);
    expect(stateAfterSecond.pipelines.specify.version).toBe("1.0.0");
  });
});
