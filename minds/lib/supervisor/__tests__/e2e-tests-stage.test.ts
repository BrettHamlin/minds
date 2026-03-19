/**
 * e2e-tests-stage.test.ts — Tests for the e2e-tests pipeline stage executor.
 *
 * Verifies:
 * - Graceful skip when no registry.json exists
 * - Graceful skip when registry has empty tests array
 * - Skips missing test files
 * - Passes when all test files pass
 * - Returns findings when a test file fails
 * - Sets ctx.checkResults.e2eTestsPass correctly
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { executeE2eTests, readE2eRegistry } from "../stages/e2e-tests.ts";
import type { PipelineStage, StageContext } from "../pipeline-types.ts";
import type { CheckResults } from "../supervisor-types.ts";
import { makeTestConfig, makeTestTmpDir } from "./test-helpers.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeStage(overrides?: Partial<PipelineStage>): PipelineStage {
  return { type: "e2e-tests", label: "E2E Tests", ...overrides };
}

function makeCheckResults(): CheckResults {
  return { diff: "", testOutput: "", testsPass: true, findings: [] };
}

function makeCtx(overrides?: Partial<StageContext>): StageContext {
  const worktreePath = join(tmpDir, "worktree");
  const config = makeTestConfig({ worktreePath, repoRoot: tmpDir });
  return {
    supervisorConfig: config,
    deps: {} as StageContext["deps"],
    standards: "",
    iteration: 1,
    worktree: worktreePath,
    branch: "minds/BRE-696",
    store: {},
    allDroneHandles: [],
    checkResults: makeCheckResults(),
    ...overrides,
  };
}

function writeRegistry(
  worktreePath: string,
  tests: Array<{ mind: string; file: string }>,
  registryPath = "tests/e2e/registry.json",
): void {
  const fullPath = join(worktreePath, registryPath);
  mkdirSync(join(worktreePath, "tests/e2e"), { recursive: true });
  writeFileSync(fullPath, JSON.stringify({ tests }));
}

function writePassingTest(worktreePath: string, relPath: string): void {
  const fullPath = join(worktreePath, relPath);
  mkdirSync(join(worktreePath, relPath.replace(/\/[^/]+$/, "")), { recursive: true });
  writeFileSync(
    fullPath,
    `import { test, expect } from "bun:test";\ntest("pass", () => expect(true).toBe(true));\n`,
  );
}

function writeFailingTest(worktreePath: string, relPath: string): void {
  const fullPath = join(worktreePath, relPath);
  mkdirSync(join(worktreePath, relPath.replace(/\/[^/]+$/, "")), { recursive: true });
  writeFileSync(
    fullPath,
    `import { test, expect } from "bun:test";\ntest("fail", () => expect(true).toBe(false));\n`,
  );
}

beforeEach(() => {
  tmpDir = makeTestTmpDir("e2e-tests-stage");
  mkdirSync(join(tmpDir, "worktree"), { recursive: true });
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// readE2eRegistry unit tests
// ---------------------------------------------------------------------------

describe("readE2eRegistry", () => {
  test("returns null when registry file does not exist", () => {
    const result = readE2eRegistry(join(tmpDir, "worktree"), "tests/e2e/registry.json");
    expect(result).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    const worktreePath = join(tmpDir, "worktree");
    mkdirSync(join(worktreePath, "tests/e2e"), { recursive: true });
    writeFileSync(join(worktreePath, "tests/e2e/registry.json"), "not-json");
    expect(readE2eRegistry(worktreePath, "tests/e2e/registry.json")).toBeNull();
  });

  test("returns null when tests field is missing", () => {
    const worktreePath = join(tmpDir, "worktree");
    mkdirSync(join(worktreePath, "tests/e2e"), { recursive: true });
    writeFileSync(join(worktreePath, "tests/e2e/registry.json"), JSON.stringify({ foo: "bar" }));
    expect(readE2eRegistry(worktreePath, "tests/e2e/registry.json")).toBeNull();
  });

  test("returns registry when valid", () => {
    const worktreePath = join(tmpDir, "worktree");
    const tests = [{ mind: "@api", file: "tests/e2e/api.test.ts" }];
    writeRegistry(worktreePath, tests);
    const result = readE2eRegistry(worktreePath, "tests/e2e/registry.json");
    expect(result).toEqual({ tests });
  });
});

// ---------------------------------------------------------------------------
// executeE2eTests — no registry
// ---------------------------------------------------------------------------

describe("executeE2eTests — no registry", () => {
  test("returns ok and sets e2eTestsPass=true when no registry file exists", async () => {
    const ctx = makeCtx();
    const result = await executeE2eTests(makeStage(), ctx);
    expect(result.ok).toBe(true);
    expect(ctx.checkResults?.e2eTestsPass).toBe(true);
  });

  test("returns ok when registry has empty tests array", async () => {
    const worktreePath = join(tmpDir, "worktree");
    writeRegistry(worktreePath, []);
    const ctx = makeCtx();
    const result = await executeE2eTests(makeStage(), ctx);
    expect(result.ok).toBe(true);
    expect(ctx.checkResults?.e2eTestsPass).toBe(true);
  });

  test("works when ctx.checkResults is undefined (no prior git-diff stage)", async () => {
    const ctx = makeCtx({ checkResults: undefined });
    const result = await executeE2eTests(makeStage(), ctx);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// executeE2eTests — registry with tests
// ---------------------------------------------------------------------------

describe("executeE2eTests — registry with tests", () => {
  test("skips test files that do not exist on disk", async () => {
    const worktreePath = join(tmpDir, "worktree");
    writeRegistry(worktreePath, [{ mind: "@transport", file: "tests/e2e/missing.test.ts" }]);
    const ctx = makeCtx();
    const result = await executeE2eTests(makeStage(), ctx);
    expect(result.ok).toBe(true);
    expect(ctx.checkResults?.e2eTestsPass).toBe(true);
  });

  test("returns ok and sets e2eTestsPass=true when all tests pass", async () => {
    const worktreePath = join(tmpDir, "worktree");
    writePassingTest(worktreePath, "tests/e2e/transport.test.ts");
    writeRegistry(worktreePath, [{ mind: "@transport", file: "tests/e2e/transport.test.ts" }]);
    const ctx = makeCtx();
    const result = await executeE2eTests(makeStage(), ctx);
    expect(result.ok).toBe(true);
    expect(ctx.checkResults?.e2eTestsPass).toBe(true);
    expect(result.findings ?? []).toHaveLength(0);
  });

  test("returns ok=false with findings when a test file fails", async () => {
    const worktreePath = join(tmpDir, "worktree");
    writeFailingTest(worktreePath, "tests/e2e/broken.test.ts");
    writeRegistry(worktreePath, [{ mind: "@transport", file: "tests/e2e/broken.test.ts" }]);
    const ctx = makeCtx();
    const result = await executeE2eTests(makeStage(), ctx);
    expect(result.ok).toBe(false);
    expect(ctx.checkResults?.e2eTestsPass).toBe(false);
    expect(result.findings).toBeDefined();
    expect(result.findings!.length).toBeGreaterThan(0);
    expect(result.findings![0].file).toBe("tests/e2e/broken.test.ts");
    expect(result.findings![0].message).toContain("@transport");
  });

  test("accumulates findings from multiple failing tests", async () => {
    const worktreePath = join(tmpDir, "worktree");
    writeFailingTest(worktreePath, "tests/e2e/fail1.test.ts");
    writeFailingTest(worktreePath, "tests/e2e/fail2.test.ts");
    writeRegistry(worktreePath, [
      { mind: "@transport", file: "tests/e2e/fail1.test.ts" },
      { mind: "@transport", file: "tests/e2e/fail2.test.ts" },
    ]);
    const ctx = makeCtx();
    const result = await executeE2eTests(makeStage(), ctx);
    expect(result.ok).toBe(false);
    expect(result.findings!.length).toBe(2);
  });

  test("filters out entries for other minds", async () => {
    const worktreePath = join(tmpDir, "worktree");
    writePassingTest(worktreePath, "tests/e2e/transport.test.ts");
    writeFailingTest(worktreePath, "tests/e2e/other.test.ts");
    writeRegistry(worktreePath, [
      { mind: "@transport", file: "tests/e2e/transport.test.ts" },
      { mind: "@other-mind", file: "tests/e2e/other.test.ts" },
    ]);
    const ctx = makeCtx();
    const result = await executeE2eTests(makeStage(), ctx);
    // @other-mind entry must be excluded; only @transport passes
    expect(result.ok).toBe(true);
    expect(ctx.checkResults?.e2eTestsPass).toBe(true);
  });

  test("returns ok when registry has entries for other minds only", async () => {
    const worktreePath = join(tmpDir, "worktree");
    writeFailingTest(worktreePath, "tests/e2e/other.test.ts");
    writeRegistry(worktreePath, [{ mind: "@other-mind", file: "tests/e2e/other.test.ts" }]);
    const ctx = makeCtx();
    const result = await executeE2eTests(makeStage(), ctx);
    expect(result.ok).toBe(true);
    expect(ctx.checkResults?.e2eTestsPass).toBe(true);
  });

  test("uses custom registryPath from stage.config", async () => {
    const worktreePath = join(tmpDir, "worktree");
    const customPath = "e2e/my-registry.json";
    mkdirSync(join(worktreePath, "e2e"), { recursive: true });
    writeFileSync(
      join(worktreePath, customPath),
      JSON.stringify({ tests: [{ mind: "@transport", file: "tests/e2e/missing.test.ts" }] }),
    );
    const ctx = makeCtx();
    const stage = makeStage({ config: { registryPath: customPath } });
    const result = await executeE2eTests(stage, ctx);
    expect(result.ok).toBe(true);
  });
});
