/**
 * group3-smoke.test.ts - Real shell execution smoke tests
 *
 * Tests that pipeline shell scripts behave correctly in realistic conditions.
 * These are integration-level tests that run actual scripts with real file I/O,
 * not just static analysis or unit tests.
 *
 * Smoke tests cover:
 * - verify-and-complete.sh: task verification logic (incomplete → exit 1, complete → exit 0)
 * - phase-dispatch.sh: phase resolution from pipeline.json
 * - orchestrator-init.sh: registry and pane setup validation
 *
 * Note: Tests that require a live tmux pane (signal emission, actual dispatch) are
 * skipped with a comment — they require a real orchestrated environment.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = execSync("git rev-parse --show-toplevel", {
  encoding: "utf-8",
  cwd: import.meta.dir,
}).trim();

const VERIFY_SCRIPT = path.join(REPO_ROOT, "src/scripts/verify-and-complete.ts");
const PHASE_DISPATCH = path.join(REPO_ROOT, "src/scripts/orchestrator/commands/phase-dispatch.ts");
const RUN_TESTS_EXECUTOR = path.join(REPO_ROOT, "src/scripts/run-tests-executor.ts");

/** Run a shell script with arguments, returning { exitCode, stdout, stderr } */
function runScript(
  scriptPath: string,
  args: string[],
  cwd?: string
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("bash", [scriptPath, ...args], {
    encoding: "utf-8",
    cwd: cwd || REPO_ROOT,
    env: { ...process.env, TMUX_PANE: "%test-orch", TMUX: "test" },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

/** Run a TypeScript script with bun, returning { exitCode, stdout, stderr } */
function runBunScript(
  scriptPath: string,
  args: string[],
  cwd?: string,
  timeout?: number
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [scriptPath, ...args], {
    encoding: "utf-8",
    cwd: cwd || REPO_ROOT,
    env: { ...process.env, TMUX_PANE: "%test-orch", TMUX: "test" },
    timeout,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

/**
 * Start a mock HTTP server as a separate process.
 * spawnSync blocks the event loop, so Bun.serve in-process can't respond.
 * This starts a real subprocess that can handle requests independently.
 */
function startMockHttpServer(
  port: number,
  handler: string
): { kill: () => void } {
  const script = `Bun.serve({ port: ${port}, fetch(req) { ${handler} } }); setInterval(() => {}, 60000);`;
  const proc = require("child_process").spawn("bun", ["-e", script], {
    stdio: "pipe",
    detached: false,
  });
  // Sync sleep to let server bind
  spawnSync("sleep", ["0.5"]);
  return {
    kill: () => {
      try { proc.kill(); } catch {}
    },
  };
}

/** Create a temporary git repo with the given file structure */
function createTempRepo(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-smoke-"));

  // Initialize git repo
  execSync("git init", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: tmpDir, stdio: "pipe" });

  // Create directory structure
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  // Symlink .collab into the temp repo so scripts can find handlers
  fs.symlinkSync(
    path.join(REPO_ROOT, ".collab"),
    path.join(tmpDir, ".collab")
  );

  return tmpDir;
}

/** Replace .collab symlink with a real config dir containing run-tests.json */
function setupRunTestsConfig(tmpDir: string, config: object): void {
  fs.unlinkSync(path.join(tmpDir, ".collab"));
  fs.mkdirSync(path.join(tmpDir, ".collab", "config"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, ".collab/config/run-tests.json"),
    JSON.stringify(config)
  );
}

/** Remove temp dir recursively */
function cleanupTempDir(tmpDir: string): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ===========================================================================
// verify-and-complete.sh: implement phase tests (5 tests)
// ===========================================================================

describe("verify-and-complete.sh: implement phase", () => {
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  test("1. exits 1 when tasks.md has incomplete tasks", () => {
    tmpDir = createTempRepo({
      "specs/001-test-feature/tasks.md": [
        "## Phase 1",
        "- [x] Completed task",
        "- [ ] Incomplete task",
        "- [x] Another completed task",
      ].join("\n"),
    });

    const result = runBunScript(VERIFY_SCRIPT, ["implement", "Test message"], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("incomplete");
  });

  test("2. exits 0 when all tasks are complete", () => {
    tmpDir = createTempRepo({
      "specs/001-test-feature/tasks.md": [
        "## Phase 1",
        "- [x] Completed task",
        "- [x] Another completed task",
        "",
        "## Phase 2",
        "- [x] Third task",
      ].join("\n"),
    });

    const result = runBunScript(VERIFY_SCRIPT, ["implement", "Test message"], tmpDir);

    // Exit 0 = verification passed; signal emission may succeed or skip (no registry)
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("All tasks complete");
  });

  test("3. exits 1 when tasks.md is missing", () => {
    // Temp repo with no tasks.md anywhere
    tmpDir = createTempRepo({
      "specs/001-test-feature/spec.md": "# Spec",
    });

    const result = runBunScript(VERIFY_SCRIPT, ["implement", "Test message"], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("not found");
  });

  test("4. exits 1 when tasks.md has only incomplete tasks", () => {
    tmpDir = createTempRepo({
      "specs/001-test-feature/tasks.md": [
        "## Phase 1",
        "- [ ] Task A",
        "- [ ] Task B",
        "- [ ] Task C",
      ].join("\n"),
    });

    const result = runBunScript(VERIFY_SCRIPT, ["implement", "Test message"], tmpDir);

    expect(result.exitCode).toBe(1);
    // Should report exactly 3 incomplete tasks
    expect(result.stdout).toMatch(/3 incomplete/);
  });

  test("5. counts only lines starting with '- [ ]' (indented items ignored)", () => {
    tmpDir = createTempRepo({
      "specs/001-test-feature/tasks.md": [
        "## Phase 1",
        "- [x] Completed",
        "- [x] Completed with note about [ ] brackets in text",  // [x] — NOT incomplete
        "  - [ ] Nested incomplete item",                         // indented — NOT matched by ^
        "- [X] Completed with uppercase X",                      // [X] uppercase — NOT matched
      ].join("\n"),
    });

    // The script uses grep -c "^- [ ]" — only matches lines starting with exactly "- [ ]"
    // Indented items (spaces before dash) don't match "^- [ ]"
    const result = runBunScript(VERIFY_SCRIPT, ["implement", "Test message"], tmpDir);

    expect(result.exitCode).toBe(0); // no top-level incomplete tasks
  });
});

// ===========================================================================
// verify-and-complete.sh: analyze phase tests (2 tests)
// ===========================================================================

describe("verify-and-complete.sh: analyze phase", () => {
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  test("6. analyze phase passes regardless of task state", () => {
    // Analyze phase has no task check — it always proceeds to signal emission
    tmpDir = createTempRepo({
      "specs/001-test-feature/tasks.md": [
        "- [ ] Some incomplete task",
      ].join("\n"),
    });

    const result = runBunScript(VERIFY_SCRIPT, ["analyze", "Analysis complete"], tmpDir);

    // Analyze phase does no verification, just emits signal
    // Signal emission may exit 0 (no registry found) or succeed
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Analysis phase checks complete");
  });

  test("7. analyze phase emits completion signal message", () => {
    tmpDir = createTempRepo({});

    const result = runBunScript(VERIFY_SCRIPT, ["analyze", "Analysis complete"], tmpDir);

    expect(result.stdout).toContain("Analysis phase checks complete");
    expect(result.stdout).toContain("Emitting completion signal");
  });
});

// ===========================================================================
// verify-and-complete.sh: other phases (1 test)
// ===========================================================================

describe("verify-and-complete.sh: generic phases", () => {
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  test("8. unknown phase passes with generic success message", () => {
    tmpDir = createTempRepo({});

    const result = runBunScript(VERIFY_SCRIPT, ["clarify", "Clarify done"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Phase clarify complete");
  });
});

// ===========================================================================
// phase-dispatch.sh: pipeline.json integration (3 tests)
// ===========================================================================

describe("phase-dispatch.ts: pipeline.json resolution", () => {
  test("9. exits 2 for unknown phase", () => {
    // Create a minimal registry so the script can read the agent pane
    const tmpDir = createTempRepo({});

    // Create registry dir and a fake registry
    const registryDir = path.join(tmpDir, ".collab", "state", "pipeline-registry");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, "TEST-999.json"),
      JSON.stringify({
        ticket_id: "TEST-999",
        agent_pane_id: "%test",
        current_step: "clarify",
        status: "running",
        nonce: "testnonce",
      })
    );

    // Remove the .collab symlink and make it a real dir with our files
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab", "config"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".collab", "state", "pipeline-registry"), { recursive: true });

    // Copy pipeline.json
    fs.copyFileSync(
      path.join(REPO_ROOT, ".collab/config/pipeline.json"),
      path.join(tmpDir, ".collab/config/pipeline.json")
    );

    // Create registry
    fs.writeFileSync(
      path.join(tmpDir, ".collab/state/pipeline-registry/TEST-999.json"),
      JSON.stringify({
        ticket_id: "TEST-999",
        agent_pane_id: "%test",
        current_step: "clarify",
        status: "running",
        nonce: "testnonce",
      })
    );

    const result = runBunScript(PHASE_DISPATCH, ["TEST-999", "nonexistent-phase"], tmpDir);

    cleanupTempDir(tmpDir);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("not found in pipeline.json");
  });

  test("10. exits 3 when registry file is missing", () => {
    const tmpDir = createTempRepo({});

    // Remove symlink, create real .collab with pipeline.json but NO registry
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab", "config"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".collab", "state", "pipeline-registry"), { recursive: true });

    fs.copyFileSync(
      path.join(REPO_ROOT, ".collab/config/pipeline.json"),
      path.join(tmpDir, ".collab/config/pipeline.json")
    );

    const result = runBunScript(PHASE_DISPATCH, ["NOTICKET-000", "clarify"], tmpDir);

    cleanupTempDir(tmpDir);

    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("Registry not found");
  });

  test("11. terminal phase exits 0 with no-op message", () => {
    // The "done" phase is terminal and has no command — dispatch should no-op
    const tmpDir = createTempRepo({});

    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab", "config"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".collab", "state", "pipeline-registry"), { recursive: true });

    fs.copyFileSync(
      path.join(REPO_ROOT, ".collab/config/pipeline.json"),
      path.join(tmpDir, ".collab/config/pipeline.json")
    );

    fs.writeFileSync(
      path.join(tmpDir, ".collab/state/pipeline-registry/TEST-001.json"),
      JSON.stringify({
        ticket_id: "TEST-001",
        agent_pane_id: "%test",
        current_step: "done",
        status: "running",
        nonce: "testnonce",
      })
    );

    const result = runBunScript(PHASE_DISPATCH, ["TEST-001", "done"], tmpDir);

    cleanupTempDir(tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("no dispatchable command");
  });
});

// ===========================================================================
// pipeline.json: command resolution smoke test (2 tests)
// ===========================================================================

describe("pipeline.json: phase command resolution via jq", () => {
  test("12. clarify phase has a /collab.clarify command", () => {
    const pipelinePath = path.join(REPO_ROOT, ".collab/config/pipeline.json");
    const result = spawnSync(
      "jq",
      ["-r", '.phases.clarify.command // "MISSING"', pipelinePath],
      { encoding: "utf-8" }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toContain("collab.clarify");
  });

  test("13. all non-terminal phases have commands", () => {
    const pipelinePath = path.join(REPO_ROOT, ".collab/config/pipeline.json");
    const pipeline = JSON.parse(fs.readFileSync(pipelinePath, "utf-8"));

    const nonTerminal = Object.entries(pipeline.phases).filter(
      ([, p]: [string, any]) => !p.terminal
    );
    for (const [id, phase] of nonTerminal as [string, any][]) {
      const hasCommand = !!(phase.command || phase.actions);
      expect(hasCommand, `Phase '${id}' missing command or actions`).toBe(true);
    }
  });
});

// ===========================================================================
// emit-run-tests-signal.ts: signal emission smoke tests (3 tests)
// ===========================================================================

describe("emit-run-tests-signal.ts: signal emission", () => {
  const EMIT_HANDLER = path.join(REPO_ROOT, "src/handlers/emit-run-tests-signal.ts");
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  function setupMockRegistry(dir: string): void {
    const registryDir = path.join(dir, ".collab/state/pipeline-registry");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, "TEST-001.json"),
      JSON.stringify({
        ticket_id: "TEST-001",
        current_step: "run_tests",
        nonce: "smoke-nonce",
        agent_pane_id: "%test-orch",
        orchestrator_pane_id: "%orch-fake",
        status: "running",
      })
    );
  }

  test("18. pass event exits 0 and writes signal queue file", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["pass", "All tests passed"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  test("19. queue file contains RUN_TESTS_COMPLETE in SIGNAL format", () => {
    // Reuses tmpDir from test 18 (same afterAll cleanup)
    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));

    expect(queue.signal).toContain("[SIGNAL:TEST-001:smoke-nonce]");
    expect(queue.signal).toContain("RUN_TESTS_COMPLETE");
    expect(queue.emitted_at).toBeDefined();
  });

  test("20. fail event writes RUN_TESTS_FAILED to queue", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["fail", "3 tests failed"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
    expect(queue.signal).toContain("RUN_TESTS_FAILED");
    expect(queue.signal).toContain("3 tests failed");
  });
});

// ===========================================================================
// emit-visual-verify-signal.ts: signal emission smoke tests (3 tests)
// ===========================================================================

describe("emit-visual-verify-signal.ts: signal emission", () => {
  const EMIT_HANDLER = path.join(REPO_ROOT, "src/handlers/emit-visual-verify-signal.ts");
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  function setupMockRegistry(dir: string): void {
    const registryDir = path.join(dir, ".collab/state/pipeline-registry");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, "TEST-001.json"),
      JSON.stringify({
        ticket_id: "TEST-001",
        current_step: "visual_verify",
        nonce: "smoke-nonce",
        agent_pane_id: "%test-orch",
        orchestrator_pane_id: "%orch-fake",
        status: "running",
      })
    );
  }

  test("21. pass event exits 0 and writes signal queue file", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["pass", "All checks passed"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  test("22. queue file contains VISUAL_VERIFY_COMPLETE in SIGNAL format", () => {
    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));

    expect(queue.signal).toContain("[SIGNAL:TEST-001:smoke-nonce]");
    expect(queue.signal).toContain("VISUAL_VERIFY_COMPLETE");
    expect(queue.emitted_at).toBeDefined();
  });

  test("23. fail event writes VISUAL_VERIFY_FAILED to queue", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["fail", "Selector missing"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
    expect(queue.signal).toContain("VISUAL_VERIFY_FAILED");
    expect(queue.signal).toContain("Selector missing");
  });
});

// ===========================================================================
// visual-verify-executor.ts: structural check smoke tests (4 tests)
// ===========================================================================

describe("visual-verify-executor.ts: structural checks", () => {
  const VV_EXECUTOR = path.join(REPO_ROOT, "src/scripts/visual-verify-executor.ts");
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  function setupVisualVerifyConfig(dir: string, config: object): void {
    fs.unlinkSync(path.join(dir, ".collab"));
    fs.mkdirSync(path.join(dir, ".collab", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".collab/config/visual-verify.json"),
      JSON.stringify(config)
    );
  }

  test("24. config missing emits VISUAL_VERIFY_ERROR", () => {
    tmpDir = createTempRepo({});

    // Replace .collab symlink with empty config dir (no visual-verify.json)
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });

    const result = runBunScript(VV_EXECUTOR, ["--cwd", tmpDir], tmpDir);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("VISUAL_VERIFY_ERROR");
  });

  test("25. config without baseUrl emits VISUAL_VERIFY_ERROR", () => {
    tmpDir = createTempRepo({});
    setupVisualVerifyConfig(tmpDir, { routes: [] });

    const result = runBunScript(VV_EXECUTOR, ["--cwd", tmpDir], tmpDir);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("VISUAL_VERIFY_ERROR");
  });

  test("26. config without routes emits VISUAL_VERIFY_ERROR", () => {
    tmpDir = createTempRepo({});
    setupVisualVerifyConfig(tmpDir, { baseUrl: "http://localhost:3000" });

    const result = runBunScript(VV_EXECUTOR, ["--cwd", tmpDir], tmpDir);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("VISUAL_VERIFY_ERROR");
  });

  test("27. unreachable server emits VISUAL_VERIFY_FAILED", () => {
    tmpDir = createTempRepo({});
    setupVisualVerifyConfig(tmpDir, {
      baseUrl: "http://localhost:19999",
      routes: [{ path: "/", name: "Home", selectors: [".app"] }],
    });

    const result = runBunScript(VV_EXECUTOR, ["--cwd", tmpDir], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("VISUAL_VERIFY_FAILED");
  });
});

// ===========================================================================
// run-tests-executor.ts: test execution smoke tests (4 tests)
// ===========================================================================

describe("run-tests-executor.ts: test execution", () => {
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  test("14. tests pass — echo exit 0 emits RUN_TESTS_COMPLETE", () => {
    tmpDir = createTempRepo({});
    setupRunTestsConfig(tmpDir, {
      command: 'echo "all tests passed"',
      workingDir: ".",
      timeout: 30,
    });

    const result = runBunScript(RUN_TESTS_EXECUTOR, ["--cwd", tmpDir], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("RUN_TESTS_COMPLETE");
  });

  test("15. tests fail — exit 1 emits RUN_TESTS_FAILED", () => {
    tmpDir = createTempRepo({});
    setupRunTestsConfig(tmpDir, {
      command: 'sh -c "echo FAIL: my-test; exit 1"',
      workingDir: ".",
      timeout: 30,
    });

    const result = runBunScript(RUN_TESTS_EXECUTOR, ["--cwd", tmpDir], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("RUN_TESTS_FAILED");
  });

  test("16. stdout captured in signal body", () => {
    tmpDir = createTempRepo({});
    setupRunTestsConfig(tmpDir, {
      command: 'sh -c "echo FAIL: line 42; exit 1"',
      workingDir: ".",
      timeout: 30,
    });

    const result = runBunScript(RUN_TESTS_EXECUTOR, ["--cwd", tmpDir], tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("FAIL: line 42");
  });

  test("17. config missing emits RUN_TESTS_ERROR", () => {
    tmpDir = createTempRepo({});

    // Replace .collab symlink with empty config dir (no run-tests.json)
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });

    const result = runBunScript(RUN_TESTS_EXECUTOR, ["--cwd", tmpDir], tmpDir);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("RUN_TESTS_ERROR");
  });
});

// ===========================================================================
// Pipeline variant config override tests (3 tests)
// ===========================================================================

describe("pipeline variant config override", () => {
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  test("28. variant config exists → configPath overridden", () => {
    // Import initPipeline dependencies inline to test the override logic
    const { resolvePaths } = require("../src/scripts/orchestrator/commands/orchestrator-init");

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-variant-smoke-"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config/pipeline-variants"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".collab/state/pipeline-registry"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "specs/test-variant"), { recursive: true });

    // Default pipeline.json
    fs.writeFileSync(
      path.join(tmpDir, ".collab/config/pipeline.json"),
      JSON.stringify({ version: "3.1", phases: { clarify: {}, done: { terminal: true } } })
    );

    // Variant pipeline
    fs.writeFileSync(
      path.join(tmpDir, ".collab/config/pipeline-variants/backend.json"),
      JSON.stringify({ version: "3.1", phases: { clarify: {}, implement: {}, done: { terminal: true } } })
    );

    // Metadata with variant
    fs.writeFileSync(
      path.join(tmpDir, "specs/test-variant/metadata.json"),
      JSON.stringify({ ticket_id: "TEST-VARIANT-001", pipeline_variant: "backend" })
    );

    const ctx = {
      ticketId: "TEST-VARIANT-001",
      orchestratorPane: "%test-orch",
      repoRoot: tmpDir,
      registryDir: path.join(tmpDir, ".collab/state/pipeline-registry"),
      groupsDir: path.join(tmpDir, ".collab/state/pipeline-groups"),
      configPath: path.join(tmpDir, ".collab/config/pipeline.json"),
      schemaPath: path.join(tmpDir, ".collab/config/pipeline.v3.schema.json"),
    };

    const result = resolvePaths(ctx);
    expect(result.pipelineVariant).toBe("backend");

    // Simulate initPipeline step 2: variant config override
    const variantPath = path.join(ctx.repoRoot, ".collab", "config", "pipeline-variants", `${result.pipelineVariant}.json`);
    expect(fs.existsSync(variantPath)).toBe(true);

    ctx.configPath = variantPath;
    const variantPipeline = JSON.parse(fs.readFileSync(ctx.configPath, "utf-8"));
    expect(Object.keys(variantPipeline.phases)).toContain("implement");
  });

  test("29. variant config missing → configPath stays default", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-variant-smoke-"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".collab/state/pipeline-registry"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "specs/test-no-variant"), { recursive: true });

    const defaultConfigPath = path.join(tmpDir, ".collab/config/pipeline.json");
    fs.writeFileSync(defaultConfigPath, JSON.stringify({ version: "3.1", phases: { clarify: {}, done: { terminal: true } } }));

    fs.writeFileSync(
      path.join(tmpDir, "specs/test-no-variant/metadata.json"),
      JSON.stringify({ ticket_id: "TEST-VARIANT-002", pipeline_variant: "nonexistent" })
    );

    const { resolvePaths: rp } = require("../src/scripts/orchestrator/commands/orchestrator-init");

    const ctx = {
      ticketId: "TEST-VARIANT-002",
      orchestratorPane: "%test-orch",
      repoRoot: tmpDir,
      registryDir: path.join(tmpDir, ".collab/state/pipeline-registry"),
      groupsDir: path.join(tmpDir, ".collab/state/pipeline-groups"),
      configPath: defaultConfigPath,
      schemaPath: path.join(tmpDir, ".collab/config/pipeline.v3.schema.json"),
    };

    const result = rp(ctx);
    expect(result.pipelineVariant).toBe("nonexistent");

    // Variant file doesn't exist → configPath should NOT change
    const variantPath = path.join(ctx.repoRoot, ".collab", "config", "pipeline-variants", `${result.pipelineVariant}.json`);
    expect(fs.existsSync(variantPath)).toBe(false);

    // configPath stays as default
    expect(ctx.configPath).toBe(defaultConfigPath);
  });

  test("30. no variant in metadata → pipelineVariant is undefined", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-variant-smoke-"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".collab/state/pipeline-registry"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "specs/test-plain"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpDir, "specs/test-plain/metadata.json"),
      JSON.stringify({ ticket_id: "TEST-VARIANT-003" })
    );

    const { resolvePaths: rp2 } = require("../src/scripts/orchestrator/commands/orchestrator-init");

    const ctx = {
      ticketId: "TEST-VARIANT-003",
      orchestratorPane: "%test-orch",
      repoRoot: tmpDir,
      registryDir: path.join(tmpDir, ".collab/state/pipeline-registry"),
      groupsDir: path.join(tmpDir, ".collab/state/pipeline-groups"),
      configPath: path.join(tmpDir, ".collab/config/pipeline.json"),
      schemaPath: path.join(tmpDir, ".collab/config/pipeline.v3.schema.json"),
    };

    const result = rp2(ctx);
    expect(result.pipelineVariant).toBeUndefined();
  });
});

// ===========================================================================
// emit-verify-execute-signal.ts: signal emission smoke tests (3 tests)
// ===========================================================================

describe("emit-verify-execute-signal.ts: signal emission", () => {
  const EMIT_HANDLER = path.join(REPO_ROOT, "src/handlers/emit-verify-execute-signal.ts");
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  function setupMockRegistry(dir: string): void {
    const registryDir = path.join(dir, ".collab/state/pipeline-registry");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, "TEST-001.json"),
      JSON.stringify({
        ticket_id: "TEST-001",
        current_step: "verify_execute",
        nonce: "smoke-nonce",
        agent_pane_id: "%test-orch",
        orchestrator_pane_id: "%orch-fake",
        status: "running",
      })
    );
  }

  test("31. pass event exits 0 and writes signal queue file", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["pass", "All checks passed"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  test("32. queue file contains VERIFY_EXECUTE_COMPLETE in SIGNAL format", () => {
    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));

    expect(queue.signal).toContain("[SIGNAL:TEST-001:smoke-nonce]");
    expect(queue.signal).toContain("VERIFY_EXECUTE_COMPLETE");
    expect(queue.emitted_at).toBeDefined();
  });

  test("33. fail event writes VERIFY_EXECUTE_FAILED to queue", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["fail", "2 of 6 checks failed"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
    expect(queue.signal).toContain("VERIFY_EXECUTE_FAILED");
    expect(queue.signal).toContain("2 of 6 checks failed");
  });
});

// ===========================================================================
// emit-pre-deploy-confirm-signal.ts: signal emission smoke tests (3 tests)
// ===========================================================================

describe("emit-pre-deploy-confirm-signal.ts: signal emission", () => {
  const EMIT_HANDLER = path.join(REPO_ROOT, "src/handlers/emit-pre-deploy-confirm-signal.ts");
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  function setupMockRegistry(dir: string): void {
    const registryDir = path.join(dir, ".collab/state/pipeline-registry");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, "TEST-001.json"),
      JSON.stringify({
        ticket_id: "TEST-001",
        current_step: "pre_deploy_confirm",
        nonce: "smoke-nonce",
        agent_pane_id: "%test-orch",
        orchestrator_pane_id: "%orch-fake",
        status: "running",
      })
    );
  }

  test("34. pass event exits 0 and writes signal queue file", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["pass", "Deploy approved"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  test("35. queue file contains PRE_DEPLOY_CONFIRM_COMPLETE in SIGNAL format", () => {
    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));

    expect(queue.signal).toContain("[SIGNAL:TEST-001:smoke-nonce]");
    expect(queue.signal).toContain("PRE_DEPLOY_CONFIRM_COMPLETE");
    expect(queue.emitted_at).toBeDefined();
  });

  test("36. fail event writes PRE_DEPLOY_CONFIRM_FAILED to queue", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["fail", "Deploy aborted by user"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
    expect(queue.signal).toContain("PRE_DEPLOY_CONFIRM_FAILED");
    expect(queue.signal).toContain("Deploy aborted by user");
  });
});

// ===========================================================================
// emit-deploy-verify-signal.ts: signal emission smoke tests (3 tests)
// ===========================================================================

describe("emit-deploy-verify-signal.ts: signal emission", () => {
  const EMIT_HANDLER = path.join(REPO_ROOT, "src/handlers/emit-deploy-verify-signal.ts");
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  function setupMockRegistry(dir: string): void {
    const registryDir = path.join(dir, ".collab/state/pipeline-registry");
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(
      path.join(registryDir, "TEST-001.json"),
      JSON.stringify({
        ticket_id: "TEST-001",
        current_step: "deploy_verify",
        nonce: "smoke-nonce",
        agent_pane_id: "%test-orch",
        orchestrator_pane_id: "%orch-fake",
        status: "running",
      })
    );
  }

  test("37. pass event exits 0 and writes signal queue file", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["pass", "All smoke routes passed"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    expect(fs.existsSync(queueFile)).toBe(true);
  });

  test("38. queue file contains DEPLOY_VERIFY_COMPLETE in SIGNAL format", () => {
    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));

    expect(queue.signal).toContain("[SIGNAL:TEST-001:smoke-nonce]");
    expect(queue.signal).toContain("DEPLOY_VERIFY_COMPLETE");
    expect(queue.emitted_at).toBeDefined();
  });

  test("39. fail event writes DEPLOY_VERIFY_FAILED to queue", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    setupMockRegistry(tmpDir);

    const result = runBunScript(EMIT_HANDLER, ["fail", "/briefing returned 500"], tmpDir);

    expect(result.exitCode).toBe(0);

    const queueFile = path.join(tmpDir, ".collab/state/signal-queue/TEST-001.json");
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8"));
    expect(queue.signal).toContain("DEPLOY_VERIFY_FAILED");
    expect(queue.signal).toContain("/briefing returned 500");
  });
});

// ===========================================================================
// collab.run-tests.md executor wiring tests (3 tests)
// ===========================================================================

describe("collab.run-tests.md executor wiring", () => {
  function readCommandFile(): string {
    return fs.readFileSync(
      path.join(REPO_ROOT, "src/commands/collab.run-tests.md"),
      "utf-8"
    );
  }

  test("40. command references run-tests-executor.ts", () => {
    const content = readCommandFile();
    expect(content).toContain("run-tests-executor.ts");
  });

  test("41. command contains deterministic executor call path", () => {
    const content = readCommandFile();
    expect(content).toContain("bun .collab/scripts/run-tests-executor");
  });

  test("42. command does NOT contain inline execution logic (spawnSync)", () => {
    const content = readCommandFile();
    expect(content).not.toContain("spawnSync");
  });
});

// ===========================================================================
// collab.visual-verify.md executor wiring tests (3 tests)
// ===========================================================================

describe("collab.visual-verify.md executor wiring", () => {
  function readCommandFile(): string {
    return fs.readFileSync(
      path.join(REPO_ROOT, "src/commands/collab.visual-verify.md"),
      "utf-8"
    );
  }

  test("43. command references visual-verify-executor.ts", () => {
    const content = readCommandFile();
    expect(content).toContain("visual-verify-executor.ts");
  });

  test("44. command has two-layer structure (Layer 1 + Layer 2)", () => {
    const content = readCommandFile();
    expect(content).toContain("Layer 1");
    expect(content).toContain("Layer 2");
  });

  test("45. command contains deterministic executor call path", () => {
    const content = readCommandFile();
    expect(content).toContain("bun .collab/scripts/visual-verify-executor");
  });
});

// ===========================================================================
// deploy-verify-executor.ts: smoke tests with mock HTTP server (5 tests)
// ===========================================================================

describe("deploy-verify-executor.ts: deploy verification", () => {
  const DV_EXECUTOR = path.join(REPO_ROOT, "src/scripts/deploy-verify-executor.ts");
  let tmpDir: string;
  let mockHandle: { kill: () => void } | null = null;

  function setupDeployVerifyConfig(dir: string, config: object): void {
    // If .collab is a symlink, remove it first
    const collabPath = path.join(dir, ".collab");
    if (fs.existsSync(collabPath)) {
      const stat = fs.lstatSync(collabPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(collabPath);
      }
    }
    fs.mkdirSync(path.join(dir, ".collab", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".collab/config/deploy-verify.json"),
      JSON.stringify(config)
    );
  }

  afterAll(() => {
    if (mockHandle) {
      mockHandle.kill();
      mockHandle = null;
    }
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  test("46. all routes healthy — exit 0 emits DEPLOY_VERIFY_COMPLETE", () => {
    // Start mock server as separate process (spawnSync blocks event loop)
    mockHandle = startMockHttpServer(
      9990,
      'return new Response("OK", { status: 200 });'
    );

    tmpDir = createTempRepo({});
    setupDeployVerifyConfig(tmpDir, {
      productionUrl: "http://localhost:9990",
      smokeRoutes: ["/", "/briefing"],
      pollIntervalSeconds: 1,
      maxWaitSeconds: 5,
    });

    const result = runBunScript(DV_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("DEPLOY_VERIFY_COMPLETE");

    mockHandle.kill();
    mockHandle = null;
  });

  test("47. route returns 503 — exit 1 emits DEPLOY_VERIFY_FAILED", () => {
    mockHandle = startMockHttpServer(
      9990,
      'const url = new URL(req.url); if (url.pathname === "/briefing") return new Response("", { status: 503 }); return new Response("OK", { status: 200 });'
    );

    tmpDir = createTempRepo({});
    setupDeployVerifyConfig(tmpDir, {
      productionUrl: "http://localhost:9990",
      smokeRoutes: ["/", "/briefing"],
      pollIntervalSeconds: 1,
      maxWaitSeconds: 5,
    });

    const result = runBunScript(DV_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("DEPLOY_VERIFY_FAILED");
    expect(result.stdout).toContain("/briefing");

    mockHandle.kill();
    mockHandle = null;
  });

  test("48. server unreachable — exit 1 emits DEPLOY_VERIFY_FAILED", () => {
    // No mock server running — port 9991 should be unreachable
    tmpDir = createTempRepo({});
    setupDeployVerifyConfig(tmpDir, {
      productionUrl: "http://localhost:9991",
      smokeRoutes: ["/"],
      pollIntervalSeconds: 1,
      maxWaitSeconds: 3,
    });

    const result = runBunScript(DV_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect([1, 2]).toContain(result.exitCode);
    expect(result.stdout).toMatch(/DEPLOY_VERIFY_FAILED|DEPLOY_VERIFY_ERROR/);
  });

  test("49. config missing — exit 2 emits DEPLOY_VERIFY_ERROR", () => {
    tmpDir = createTempRepo({});

    // Replace .collab symlink with empty config dir (no deploy-verify.json)
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });

    const result = runBunScript(DV_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("DEPLOY_VERIFY_ERROR");
  });

  test("50. config missing productionUrl — exit 2 emits DEPLOY_VERIFY_ERROR", () => {
    tmpDir = createTempRepo({});
    setupDeployVerifyConfig(tmpDir, {
      smokeRoutes: ["/"],
    });

    const result = runBunScript(DV_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("DEPLOY_VERIFY_ERROR");
  });
});

// ===========================================================================
// collab.deploy-verify.md executor wiring test (1 test)
// ===========================================================================

describe("collab.deploy-verify.md executor wiring", () => {
  test("51. command references deploy-verify-executor.ts call path", () => {
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "src/commands/collab.deploy-verify.md"),
      "utf-8"
    );
    expect(content).toContain("bun .collab/scripts/deploy-verify-executor");
  });
});

// ===========================================================================
// verify-execute-executor.ts: smoke tests (12 tests)
// ===========================================================================

describe("verify-execute-executor.ts: verification checks", () => {
  const VE_EXECUTOR = path.join(REPO_ROOT, "src/scripts/verify-execute-executor.ts");
  let tmpDir: string;
  let mockHandle: { kill: () => void } | null = null;

  function setupVerifyChecklist(dir: string, config: object): void {
    const collabPath = path.join(dir, ".collab");
    if (fs.existsSync(collabPath)) {
      const stat = fs.lstatSync(collabPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(collabPath);
      }
    }
    fs.mkdirSync(path.join(dir, ".collab", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".collab/config/verify-checklist.json"),
      JSON.stringify(config)
    );
  }

  afterAll(() => {
    if (mockHandle) {
      mockHandle.kill();
      mockHandle = null;
    }
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  test("52. file_exists passes — exit 0 VERIFY_EXECUTE_COMPLETE", () => {
    tmpDir = createTempRepo({
      "src/index.ts": "export default {};",
    });
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "file_exists", path: "src/index.ts", label: "index exists" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("VERIFY_EXECUTE_COMPLETE");
    expect(result.stdout).toContain("1/1");
  });

  test("53. file_exists fails — exit 1 VERIFY_EXECUTE_FAILED", () => {
    tmpDir = createTempRepo({});
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "file_exists", path: "nonexistent.ts", label: "missing file" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("VERIFY_EXECUTE_FAILED");
  });

  test("54. file_contains match — exit 0", () => {
    tmpDir = createTempRepo({
      "src/app.ts": "export default function handler() { return 42; }",
    });
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "file_contains", path: "src/app.ts", pattern: "export default", label: "has export" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("VERIFY_EXECUTE_COMPLETE");
  });

  test("55. file_contains no match — exit 1", () => {
    tmpDir = createTempRepo({
      "src/app.ts": "const x = 1;",
    });
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "file_contains", path: "src/app.ts", pattern: "export default", label: "has export" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("VERIFY_EXECUTE_FAILED");
  });

  test("56. command_succeeds passes — exit 0", () => {
    tmpDir = createTempRepo({});
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "command_succeeds", command: "echo ok", label: "echo ok" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("VERIFY_EXECUTE_COMPLETE");
  });

  test("57. command_succeeds fails — exit 1", () => {
    tmpDir = createTempRepo({});
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "command_succeeds", command: "exit 1", label: "fail cmd" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("VERIFY_EXECUTE_FAILED");
  });

  test("58. config missing — exit 2 VERIFY_EXECUTE_ERROR", () => {
    tmpDir = createTempRepo({});
    fs.unlinkSync(path.join(tmpDir, ".collab"));
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("VERIFY_EXECUTE_ERROR");
  });

  test("59. empty checks array — exit 0 (vacuous pass)", () => {
    tmpDir = createTempRepo({});
    setupVerifyChecklist(tmpDir, { checks: [] });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("VERIFY_EXECUTE_COMPLETE");
    expect(result.stdout).toContain("0/0");
  });

  test("60. json_field match — exit 0", () => {
    tmpDir = createTempRepo({
      "package.json": JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
    });
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "json_field", path: "package.json", field: "version", expected: "1.0.0", label: "version check" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("VERIFY_EXECUTE_COMPLETE");
  });

  test("61. json_field mismatch — exit 1", () => {
    tmpDir = createTempRepo({
      "package.json": JSON.stringify({ name: "test-pkg", version: "0.9.0" }),
    });
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "json_field", path: "package.json", field: "version", expected: "1.0.0", label: "version check" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("VERIFY_EXECUTE_FAILED");
  });

  test("62. http_200 passes — mock server returns 200", () => {
    mockHandle = startMockHttpServer(
      9989,
      'return new Response("OK", { status: 200 });'
    );

    tmpDir = createTempRepo({});
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "http_200", url: "http://localhost:9989/api/health", label: "health check" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("VERIFY_EXECUTE_COMPLETE");

    mockHandle.kill();
    mockHandle = null;
  });

  test("63. http_200 fails — mock server returns 500", () => {
    mockHandle = startMockHttpServer(
      9989,
      'return new Response("Internal Server Error", { status: 500 });'
    );

    tmpDir = createTempRepo({});
    setupVerifyChecklist(tmpDir, {
      checks: [
        { type: "http_200", url: "http://localhost:9989/api/health", label: "health check" },
      ],
    });

    const result = runBunScript(VE_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("VERIFY_EXECUTE_FAILED");

    mockHandle.kill();
    mockHandle = null;
  });
});

// ===========================================================================
// collab.verify-execute.md executor wiring test (1 test)
// ===========================================================================

describe("collab.verify-execute.md executor wiring", () => {
  test("64. command references verify-execute-executor.ts call path", () => {
    const content = fs.readFileSync(
      path.join(REPO_ROOT, "src/commands/collab.verify-execute.md"),
      "utf-8"
    );
    expect(content).toContain("bun .collab/scripts/verify-execute-executor");
  });
});

// ===========================================================================
// pre-deploy-summary.ts: smoke tests (4 tests)
// ===========================================================================

describe("pre-deploy-summary.ts: deployment context aggregation", () => {
  const PDS_EXECUTOR = path.join(REPO_ROOT, "src/scripts/pre-deploy-summary.ts");
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  function setupSpecAndConfig(
    dir: string,
    opts: {
      specMd?: string;
      metadata?: object | string;
      deployVerify?: object | string;
    }
  ): void {
    // Create specs directory with spec.md and metadata.json
    if (opts.specMd !== undefined) {
      fs.mkdirSync(path.join(dir, "specs/test-feature"), { recursive: true });
      fs.writeFileSync(path.join(dir, "specs/test-feature/spec.md"), opts.specMd);
    }
    if (opts.metadata !== undefined) {
      fs.mkdirSync(path.join(dir, "specs/test-feature"), { recursive: true });
      const content = typeof opts.metadata === "string"
        ? opts.metadata
        : JSON.stringify(opts.metadata);
      fs.writeFileSync(path.join(dir, "specs/test-feature/metadata.json"), content);
    }
    // Create deploy-verify.json
    if (opts.deployVerify !== undefined) {
      const collabPath = path.join(dir, ".collab");
      if (fs.existsSync(collabPath)) {
        const stat = fs.lstatSync(collabPath);
        if (stat.isSymbolicLink()) fs.unlinkSync(collabPath);
      }
      fs.mkdirSync(path.join(dir, ".collab/config"), { recursive: true });
      const content = typeof opts.deployVerify === "string"
        ? opts.deployVerify
        : JSON.stringify(opts.deployVerify);
      fs.writeFileSync(path.join(dir, ".collab/config/deploy-verify.json"), content);
    }
  }

  test("65. full context — exit 0 with all fields populated", () => {
    tmpDir = createTempRepo({});
    setupSpecAndConfig(tmpDir, {
      specMd: "# BRE-248 Next.js initial setup\n\n- [ ] AC1: Landing page renders\n- [ ] AC2: Auth flow works\n",
      metadata: {
        ticket_id: "BRE-248",
        branch_name: "feat/BRE-248-nextjs-setup",
        pipeline_variant: "deploy",
        project_name: "paper-clips-frontend",
      },
      deployVerify: {
        productionUrl: "https://paper-clips.net",
        smokeRoutes: ["/", "/briefing"],
      },
    });

    const result = runBunScript(PDS_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.ticketId).toBe("BRE-248");
    expect(json.ticketTitle).toContain("Next.js initial setup");
    expect(json.productionUrl).toBe("https://paper-clips.net");
    expect(json.smokeRoutes).toEqual(["/", "/briefing"]);
    expect(json.service).toBe("paper-clips-frontend");
    expect(json.acSummary.length).toBe(2);
    expect(json.warnings.length).toBe(0);
  });

  test("66. missing deploy config — exit 0 with warnings", () => {
    tmpDir = createTempRepo({});
    setupSpecAndConfig(tmpDir, {
      specMd: "# Test Feature\n\n- [ ] AC1: Works\n",
      metadata: { ticket_id: "BRE-100", branch_name: "feat/test" },
    });

    const result = runBunScript(PDS_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.ticketId).toBe("BRE-100");
    expect(json.warnings).toContain("deploy-verify.json not found");
    expect(json.productionUrl).toBeUndefined();
  });

  test("67. missing spec — exit 0 with warnings and partial data", () => {
    tmpDir = createTempRepo({});
    // Only deploy config, no spec directory
    const collabPath = path.join(tmpDir, ".collab");
    if (fs.existsSync(collabPath)) {
      const stat = fs.lstatSync(collabPath);
      if (stat.isSymbolicLink()) fs.unlinkSync(collabPath);
    }
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".collab/config/deploy-verify.json"),
      JSON.stringify({ productionUrl: "https://example.com", smokeRoutes: ["/"] })
    );

    const result = runBunScript(PDS_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.warnings).toContain("No spec directory found (specs/*/spec.md)");
    expect(json.productionUrl).toBe("https://example.com");
  });

  test("68. malformed metadata — exit 0 with warnings", () => {
    tmpDir = createTempRepo({});
    setupSpecAndConfig(tmpDir, {
      specMd: "# Test\n",
      metadata: "not valid json{{{",
      deployVerify: { productionUrl: "https://example.com", smokeRoutes: ["/"] },
    });

    const result = runBunScript(PDS_EXECUTOR, ["--cwd", tmpDir], tmpDir, 15000);

    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.warnings).toContain("metadata.json found but malformed");
  });
});

// ===========================================================================
// collab.install.ts: installer copy logic smoke tests (2 tests)
// ===========================================================================

describe("collab.install.ts: installer scaffold logic", () => {
  let tmpDir: string;

  afterAll(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  test("69. installer copies pipeline variant files", () => {
    tmpDir = createTempRepo({});
    // Remove symlink to avoid writing to real .collab
    const collabPath = path.join(tmpDir, ".collab");
    if (fs.existsSync(collabPath)) {
      const stat = fs.lstatSync(collabPath);
      if (stat.isSymbolicLink()) fs.unlinkSync(collabPath);
    }
    fs.mkdirSync(path.join(tmpDir, ".collab/config/pipeline-variants"), { recursive: true });

    // Create mock source variant files
    const srcVariants = path.join(tmpDir, "src-variants");
    fs.mkdirSync(srcVariants, { recursive: true });
    fs.writeFileSync(path.join(srcVariants, "backend.json"), '{"version":"3.1"}');
    fs.writeFileSync(path.join(srcVariants, "deploy.json"), '{"version":"3.1"}');

    // Run the same find/cp the installer uses
    execSync(
      `find "${srcVariants}" -name "*.json" -exec cp {} "${tmpDir}/.collab/config/pipeline-variants/" \\;`,
      { shell: true }
    );

    const copied = fs.readdirSync(path.join(tmpDir, ".collab/config/pipeline-variants"))
      .filter((f) => f.endsWith(".json"));
    expect(copied.length).toBe(2);
    expect(copied).toContain("backend.json");
    expect(copied).toContain("deploy.json");
  });

  test("70. installer scaffolds configs but skips existing", () => {
    tmpDir = createTempRepo({});
    const collabPath = path.join(tmpDir, ".collab");
    if (fs.existsSync(collabPath)) {
      const stat = fs.lstatSync(collabPath);
      if (stat.isSymbolicLink()) fs.unlinkSync(collabPath);
    }
    fs.mkdirSync(path.join(tmpDir, ".collab/config"), { recursive: true });

    // Pre-existing config that should NOT be overwritten
    fs.writeFileSync(
      path.join(tmpDir, ".collab/config/run-tests.json"),
      '{"command":"bun test","customized":true}'
    );

    // Mock source defaults
    const srcDefaults = path.join(tmpDir, "src-defaults");
    fs.mkdirSync(srcDefaults, { recursive: true });
    fs.writeFileSync(path.join(srcDefaults, "run-tests.json"), '{"command":"npm test"}');
    fs.writeFileSync(path.join(srcDefaults, "visual-verify.json"), '{"baseUrl":"http://localhost:3000"}');

    // Replicate installer scaffold logic
    const configs = [
      { src: path.join(srcDefaults, "run-tests.json"), dest: path.join(tmpDir, ".collab/config/run-tests.json") },
      { src: path.join(srcDefaults, "visual-verify.json"), dest: path.join(tmpDir, ".collab/config/visual-verify.json") },
    ];
    let scaffoldCount = 0;
    for (const cfg of configs) {
      if (!fs.existsSync(cfg.dest) && fs.existsSync(cfg.src)) {
        fs.copyFileSync(cfg.src, cfg.dest);
        scaffoldCount++;
      }
    }

    // run-tests.json should NOT be overwritten (already existed)
    const existingConfig = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".collab/config/run-tests.json"), "utf-8")
    );
    expect(existingConfig.customized).toBe(true);
    expect(existingConfig.command).toBe("bun test");

    // visual-verify.json should be scaffolded (didn't exist)
    expect(scaffoldCount).toBe(1);
    const newConfig = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".collab/config/visual-verify.json"), "utf-8")
    );
    expect(newConfig.baseUrl).toBe("http://localhost:3000");
  });
});
