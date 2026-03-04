/**
 * Integration tests for pipelines remove.
 *
 * Calls install() then remove() directly against an in-process local registry.
 *
 * Tests:
 *  1. Remove single pipeline — pipeline removed from state + lockfile, other untouched
 *  2. Remove updates CLI requiredBy — jq no longer required by removed pipeline
 *  3. Remove not-installed pipeline — graceful no-op (no error, no exit)
 */

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { install } from "../../src/cli/commands/pipelines/install.js";
import { remove } from "../../src/cli/commands/pipelines/remove.js";
import { readState, addCli } from "../../src/cli/lib/state.js";
import { writeState } from "../../src/cli/lib/state.js";
import { readLockfile } from "../../src/cli/lib/lockfile.js";
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

// ─── Test 1: remove pipeline ───────────────────────────────────────────────────

describe("remove: single pipeline", () => {
  test("remove specify — removed from state + lockfile, plan untouched", async () => {
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
        commands: ["commands/collab.plan.md"],
        commandFiles: { "collab.plan.md": "# plan\n" },
      },
    ]);

    const opts = {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    };

    // Install both
    await install(["specify"], opts);
    await install(["plan"], opts);

    // Remove specify
    await remove(["specify"], {
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
    });

    const state = readState(env.statePath);
    expect(state.pipelines.specify).toBeUndefined();
    expect(state.pipelines.plan).toBeDefined();

    const lockfile = readLockfile(env.lockPath);
    expect(lockfile!.pipelines.specify).toBeUndefined();
    expect(lockfile!.pipelines.plan).toBeDefined();

    // Tarball cache dir removed
    expect(existsSync(join(env.installDir, "specify"))).toBe(false);
    // plan's cache untouched
    expect(existsSync(join(env.installDir, "plan"))).toBe(true);
  });
});

// ─── Test 2: requiredBy updated on remove ────────────────────────────────────

describe("remove: CLI requiredBy cleanup", () => {
  test("remove specify — jq.requiredBy no longer includes specify", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry([
      {
        name: "specify",
        version: "1.2.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify\n" },
      },
    ]);

    await install(["specify"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    // Manually register jq as required by specify (simulate CLI dep tracking)
    let state = readState(env.statePath);
    state = addCli(state, { name: "jq", version: "1.7.1", requiredBy: ["specify"] });
    writeState(env.statePath, state);

    // Remove specify
    await remove(["specify"], {
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
    });

    const updatedState = readState(env.statePath);
    expect(updatedState.pipelines.specify).toBeUndefined();

    // jq's requiredBy should no longer include specify
    const jq = updatedState.clis.jq;
    if (jq) {
      expect(jq.requiredBy).not.toContain("specify");
    }
  });
});

// ─── Test 3: remove not-installed ────────────────────────────────────────────

describe("remove: not-installed pipeline", () => {
  test("removes a pipeline that is not installed — no error, state unchanged", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry([]);

    // No install — remove should be a no-op
    await remove(["nonexistent"], {
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
    });

    const state = readState(env.statePath);
    expect(Object.keys(state.pipelines)).toHaveLength(0);
  });
});
