/**
 * Integration tests for pack install + remove.
 *
 * Calls install()/remove() directly against an in-process local registry.
 *
 * Tests:
 *  1. Install pack — both component pipelines installed, lockfile has resolved map
 *  2. Remove pack — state pack entry removed (component pipelines remain)
 *  3. Install pack then install overlapping component — no duplicate, state consistent
 */

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { install } from "../../src/cli/commands/pipelines/install.js";
import { remove } from "../../src/cli/commands/pipelines/remove.js";
import { readState } from "../../src/cli/lib/state.js";
import { readLockfile } from "../../src/cli/lib/lockfile.js";
import { createTestEnv, type TestEnv } from "../helpers/test-env.js";
import { startLocalRegistry, type LocalRegistry } from "../helpers/local-registry.js";

// Shared fixture specs — specify + plan pipelines + specfactory pack
const SPECIFY_SPEC = {
  name: "specify",
  version: "1.2.0",
  commands: ["commands/collab.specify.md"],
  commandFiles: { "collab.specify.md": "# specify\n" },
};
const PLAN_SPEC = {
  name: "plan",
  version: "1.1.0",
  dependencies: [{ name: "specify", version: ">=1.0.0" }],
  commands: ["commands/collab.plan.md"],
  commandFiles: { "collab.plan.md": "# plan\n" },
};
const PACK_SPEC = {
  name: "specfactory",
  version: "2.0.0",
  type: "pack" as const,
  description: "Full spec-to-implementation pack",
  dependencies: [
    { name: "specify", version: ">=1.0.0" },
    { name: "plan", version: ">=1.0.0" },
  ],
  pipelines: ["specify", "plan"],
  commands: [],
};

let env: TestEnv | null = null;
let registry: LocalRegistry | null = null;

afterEach(async () => {
  await env?.cleanup();
  await registry?.stop();
  env = null;
  registry = null;
});

// ─── Test 1: install pack ─────────────────────────────────────────────────────

describe("pack-install: install pack", () => {
  test("specfactory install — specify + plan both installed, commands copied", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry(
      [SPECIFY_SPEC, PLAN_SPEC],
      [PACK_SPEC]
    );

    await install(["specfactory"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    // Both component pipelines installed in state
    const state = readState(env.statePath);
    expect(state.pipelines.specify).toBeDefined();
    expect(state.pipelines.plan).toBeDefined();

    // Lockfile records both pipelines
    const lockfile = readLockfile(env.lockPath);
    expect(lockfile!.pipelines.specify).toBeDefined();
    expect(lockfile!.pipelines.plan).toBeDefined();

    // Command files present
    expect(existsSync(join(env.commandsDir, "collab.specify.md"))).toBe(true);
    expect(existsSync(join(env.commandsDir, "collab.plan.md"))).toBe(true);
  });
});

// ─── Test 2: remove pack ──────────────────────────────────────────────────────

describe("pack-install: remove pack entry", () => {
  test("remove specfactory — pack components remain as direct installs in state", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry(
      [SPECIFY_SPEC, PLAN_SPEC],
      [PACK_SPEC]
    );

    await install(["specfactory"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    // Remove the specfactory pack
    await remove(["specfactory"], {
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
    });

    // specfactory itself is not a pipeline entry in state — only specify + plan are
    const state = readState(env.statePath);
    // Component pipelines survive since remove() only removes what's named
    // (specfactory is not in state.pipelines, only specify + plan are)
    expect(state.pipelines.specify).toBeDefined();
    expect(state.pipelines.plan).toBeDefined();
  });
});

// ─── Test 3: pack then direct install of same pipeline ───────────────────────

describe("pack-install: overlapping component install", () => {
  test("install specfactory then specify directly — no duplicate entry", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry(
      [SPECIFY_SPEC, PLAN_SPEC],
      [PACK_SPEC]
    );

    const opts = {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    };

    // Install pack (installs specify + plan as components)
    await install(["specfactory"], opts);

    // Install specify directly (already installed — should be skipped)
    await install(["specify"], opts);

    const state = readState(env.statePath);
    // Still only one entry for specify
    const specifyKeys = Object.keys(state.pipelines).filter((k) => k === "specify");
    expect(specifyKeys).toHaveLength(1);
    expect(state.pipelines.specify.version).toBe("1.2.0");
  });
});
