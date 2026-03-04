/**
 * Integration tests for pack install + remove.
 *
 * Calls install()/remove() directly against an in-process local registry.
 *
 * Tests:
 *  1. Install pack — both component pipelines installed, lockfile has resolved map
 *  2. Remove pack — state pack entry removed (component pipelines remain)
 *  3. Install pack then install overlapping component — no duplicate, state consistent
 *  4. Install pipeline with handlers — handler files placed in .collab/handlers/
 *  5. Install pipeline with executors — executor files placed in .collab/scripts/
 *  6. Install pipeline with both handlers + executors — both directories populated
 *  7. Install pack with handler/executor pipelines — all files placed correctly
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

// ─── Test 4: handler files placed correctly ───────────────────────────────────

describe("pack-install: pipeline with handlers", () => {
  test("handler .ts files placed in .collab/handlers/", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry([
      {
        name: "run-tests",
        version: "1.0.0",
        commands: ["commands/collab.run-tests.md"],
        commandFiles: { "collab.run-tests.md": "# run-tests\n" },
        handlers: ["handlers/emit-run-tests-signal.ts"],
        handlerFiles: { "emit-run-tests-signal.ts": "// emit-run-tests-signal\n" },
      },
    ]);

    await install(["run-tests"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
      handlersDir: env.handlersDir,
      executorsDir: env.executorsDir,
    });

    // Command file placed
    expect(existsSync(join(env.commandsDir, "collab.run-tests.md"))).toBe(true);
    // Handler placed in .collab/handlers/
    expect(existsSync(join(env.handlersDir, "emit-run-tests-signal.ts"))).toBe(true);
    // State updated
    const state = readState(env.statePath);
    expect(state.pipelines["run-tests"]).toBeDefined();
  });
});

// ─── Test 5: executor files placed correctly ──────────────────────────────────

describe("pack-install: pipeline with executors", () => {
  test("executor .ts files placed in .collab/scripts/", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry([
      {
        name: "visual-verify",
        version: "1.0.0",
        commands: ["commands/collab.visual-verify.md"],
        commandFiles: { "collab.visual-verify.md": "# visual-verify\n" },
        executors: ["executors/visual-verify-executor.ts"],
        executorFiles: { "visual-verify-executor.ts": "// visual-verify-executor\n" },
      },
    ]);

    await install(["visual-verify"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
      handlersDir: env.handlersDir,
      executorsDir: env.executorsDir,
    });

    // Command file placed
    expect(existsSync(join(env.commandsDir, "collab.visual-verify.md"))).toBe(true);
    // Executor placed in .collab/scripts/
    expect(existsSync(join(env.executorsDir, "visual-verify-executor.ts"))).toBe(true);
    // State updated
    const state = readState(env.statePath);
    expect(state.pipelines["visual-verify"]).toBeDefined();
  });
});

// ─── Test 6: pipeline with both handlers + executors ─────────────────────────

describe("pack-install: pipeline with handlers and executors", () => {
  test("both handler and executor files placed correctly", async () => {
    env = await createTestEnv();
    registry = await startLocalRegistry([
      {
        name: "deploy-verify",
        version: "1.0.0",
        commands: ["commands/collab.deploy-verify.md"],
        commandFiles: { "collab.deploy-verify.md": "# deploy-verify\n" },
        handlers: ["handlers/emit-deploy-verify-signal.ts"],
        handlerFiles: { "emit-deploy-verify-signal.ts": "// emit-deploy-verify-signal\n" },
        executors: ["executors/deploy-verify-executor.ts"],
        executorFiles: { "deploy-verify-executor.ts": "// deploy-verify-executor\n" },
      },
    ]);

    await install(["deploy-verify"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
      handlersDir: env.handlersDir,
      executorsDir: env.executorsDir,
    });

    // All three file types placed
    expect(existsSync(join(env.commandsDir, "collab.deploy-verify.md"))).toBe(true);
    expect(existsSync(join(env.handlersDir, "emit-deploy-verify-signal.ts"))).toBe(true);
    expect(existsSync(join(env.executorsDir, "deploy-verify-executor.ts"))).toBe(true);
    // State updated
    const state = readState(env.statePath);
    expect(state.pipelines["deploy-verify"]).toBeDefined();
  });
});

// ─── Test 7: pack install — all handler/executor files placed ─────────────────

describe("pack-install: pack with handler/executor pipelines", () => {
  test("backend-pack install places commands, handlers, and executors for all components", async () => {
    env = await createTestEnv();

    const SPECIFY_WITH_FILES = {
      name: "specify",
      version: "1.2.0",
      commands: ["commands/collab.specify.md"],
      commandFiles: { "collab.specify.md": "# specify\n" },
    };
    const RUN_TESTS_WITH_FILES = {
      name: "run-tests",
      version: "1.0.0",
      commands: ["commands/collab.run-tests.md"],
      commandFiles: { "collab.run-tests.md": "# run-tests\n" },
      handlers: ["handlers/emit-run-tests-signal.ts"],
      handlerFiles: { "emit-run-tests-signal.ts": "// emit-run-tests-signal\n" },
      executors: ["executors/run-tests-executor.ts"],
      executorFiles: { "run-tests-executor.ts": "// run-tests-executor\n" },
    };
    const BACKEND_PACK_SPEC = {
      name: "backend-pack",
      version: "1.0.0",
      type: "pack" as const,
      description: "Backend workflow pack",
      dependencies: [
        { name: "specify", version: ">=1.0.0" },
        { name: "run-tests", version: ">=1.0.0" },
      ],
      pipelines: ["specify", "run-tests"],
      commands: [],
    };

    registry = await startLocalRegistry(
      [SPECIFY_WITH_FILES, RUN_TESTS_WITH_FILES],
      [BACKEND_PACK_SPEC]
    );

    await install(["backend-pack"], {
      registryUrl: registry.registryUrl,
      statePath: env.statePath,
      lockPath: env.lockPath,
      installDir: env.installDir,
      commandsDir: env.commandsDir,
      handlersDir: env.handlersDir,
      executorsDir: env.executorsDir,
    });

    // Both pipelines in state
    const state = readState(env.statePath);
    expect(state.pipelines.specify).toBeDefined();
    expect(state.pipelines["run-tests"]).toBeDefined();

    // Command files placed for both
    expect(existsSync(join(env.commandsDir, "collab.specify.md"))).toBe(true);
    expect(existsSync(join(env.commandsDir, "collab.run-tests.md"))).toBe(true);

    // Handler and executor for run-tests placed
    expect(existsSync(join(env.handlersDir, "emit-run-tests-signal.ts"))).toBe(true);
    expect(existsSync(join(env.executorsDir, "run-tests-executor.ts"))).toBe(true);
  });
});
