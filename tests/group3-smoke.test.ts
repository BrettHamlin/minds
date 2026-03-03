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
  cwd?: string
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [scriptPath, ...args], {
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
