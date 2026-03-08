/**
 * Integration tests for pipelines update.
 *
 * Calls update() directly against an in-process local registry.
 *
 * Tests:
 *  1. Update available — install v1.0.0, registry has v1.1.0 → shows diff
 *  2. No updates — install v1.0.0, registry also v1.0.0 → "up to date"
 *  3. Update --yes applies update — lockfile entry updated to new version
 */

import { describe, test, expect, afterEach } from "bun:test";
import { install } from "../../minds/cli/commands/pipelines/install.js";
import { update } from "../../minds/cli/commands/pipelines/update.js";
import { readState } from "../../minds/cli/lib/state.js";
import { readLockfile } from "../../minds/cli/lib/lockfile.js";
import { createTestEnv, type TestEnv } from "../helpers/test-env.js";
import { startLocalRegistry, type LocalRegistry } from "../helpers/local-registry.js";

let env: TestEnv | null = null;
let registryOld: LocalRegistry | null = null;
let registryNew: LocalRegistry | null = null;

afterEach(async () => {
  await env?.cleanup();
  await registryOld?.stop();
  await registryNew?.stop();
  env = null;
  registryOld = null;
  registryNew = null;
});

// ─── Test 1: update available ──────────────────────────────────────────────────

describe("update: update available", () => {
  test("install v1.0.0, registry has v1.1.0 — diff shows version bump", async () => {
    env = await createTestEnv();

    // v1.0.0 registry for initial install
    registryOld = await startLocalRegistry([
      {
        name: "specify",
        version: "1.0.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify v1\n" },
      },
    ]);

    await install(["specify"], {
      registryUrl: registryOld.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    // Now switch to a registry that has v1.1.0
    registryNew = await startLocalRegistry([
      {
        name: "specify",
        version: "1.1.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify v1.1\n" },
      },
    ]);

    // update without --yes: should report the diff but not apply
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      await update([], {
        registryUrl: registryNew.registryUrl,
        statePath: env.statePath,
        lockPath: env.lockPath,
        installDir: env.installDir,
      });
    } finally {
      console.log = originalLog;
    }

    const outputStr = output.join("\n");
    expect(outputStr).toContain("specify");
    expect(outputStr).toContain("1.0.0");
    expect(outputStr).toContain("1.1.0");
  });
});

// ─── Test 2: no updates ────────────────────────────────────────────────────────

describe("update: no updates available", () => {
  test("install v1.0.0, registry also v1.0.0 — all up to date", async () => {
    env = await createTestEnv();
    registryOld = await startLocalRegistry([
      {
        name: "specify",
        version: "1.0.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify\n" },
      },
    ]);

    await install(["specify"], {
      registryUrl: registryOld.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      await update([], {
        registryUrl: registryOld.registryUrl,
        statePath: env.statePath,
        lockPath: env.lockPath,
        installDir: env.installDir,
      });
    } finally {
      console.log = originalLog;
    }

    const outputStr = output.join("\n");
    expect(outputStr).toContain("up to date");
  });
});

// ─── Test 3: update --yes applies update ──────────────────────────────────────

describe("update: --yes applies update", () => {
  test("apply update to v1.1.0 — state + lockfile reflect new version", async () => {
    env = await createTestEnv();

    registryOld = await startLocalRegistry([
      {
        name: "specify",
        version: "1.0.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify v1\n" },
      },
    ]);

    await install(["specify"], {
      registryUrl: registryOld.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
    });

    registryNew = await startLocalRegistry([
      {
        name: "specify",
        version: "1.1.0",
        commands: ["commands/collab.specify.md"],
        commandFiles: { "collab.specify.md": "# specify v1.1\n" },
      },
    ]);

    // Apply update with --yes
    await update([], {
      registryUrl: registryNew.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      yes: true,
    });

    // State should now show v1.1.0
    const state = readState(env.statePath);
    expect(state.pipelines.specify.version).toBe("1.1.0");

    // Lockfile should show v1.1.0
    const lockfile = readLockfile(env.lockPath);
    expect(lockfile!.pipelines.specify.resolvedVersion).toBe("1.1.0");
  });
});
