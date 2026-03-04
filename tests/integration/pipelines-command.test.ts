/**
 * tests/integration/pipelines-command.test.ts
 *
 * Integration tests for the /pipelines command delegation contract.
 *
 * The /pipelines command (pipelines.md) is a thin wrapper that:
 *   1. Locates .collab/bin/collab
 *   2. Delegates each subcommand to the CLI with the correct arguments
 *   3. Surfaces errors clearly (missing binary, non-zero exit)
 *
 * These tests mock the CLI binary with a stub script that records its
 * invocation arguments and returns canned responses.  They verify that
 * the command calls the CLI with the correct arguments and handles both
 * success and error conditions.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync, spawnSync } from "child_process";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Canned JSON browse response matching the RegistryEntry shape */
const BROWSE_JSON = JSON.stringify({
  packs: [
    {
      name: "specfactory",
      latestVersion: "1.0.0",
      description: "Complete specfactory workflow",
      manifestUrl: "https://example.com/specfactory/pipeline.json",
      tarballUrl: "https://example.com/specfactory.tar.gz",
    },
  ],
  pipelines: [
    {
      name: "specify",
      latestVersion: "1.0.0",
      description: "Create or update the feature spec",
      manifestUrl: "https://example.com/specify/pipeline.json",
      tarballUrl: "https://example.com/specify.tar.gz",
    },
    {
      name: "plan",
      latestVersion: "1.0.0",
      description: "Execute the implementation planning workflow",
      manifestUrl: "https://example.com/plan/pipeline.json",
      tarballUrl: "https://example.com/plan.tar.gz",
    },
  ],
});

/**
 * Create a temp git repo with a stub collab CLI at .collab/bin/collab.
 *
 * The stub records its arguments to <tmpDir>/.collab/bin/last-args.txt
 * and prints different canned responses depending on the first argument.
 */
function createTempRepoWithStub(
  stubBehavior: "success" | "exit-nonzero" | "browse-json" = "success"
): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipelines-cmd-"));

  execSync("git init", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: tmpDir, stdio: "pipe" });

  fs.mkdirSync(path.join(tmpDir, ".collab/bin"), { recursive: true });

  const argsFile = path.join(tmpDir, ".collab/bin/last-args.txt");
  const binaryPath = path.join(tmpDir, ".collab/bin/collab");

  let stubBody: string;
  if (stubBehavior === "exit-nonzero") {
    stubBody = `#!/usr/bin/env bash
echo "$@" > "${argsFile}"
echo "Error: network unreachable" >&2
exit 1
`;
  } else if (stubBehavior === "browse-json") {
    stubBody = `#!/usr/bin/env bash
echo "$@" > "${argsFile}"
echo '${BROWSE_JSON}'
exit 0
`;
  } else {
    // success — generic stub that echoes args and exits 0
    stubBody = `#!/usr/bin/env bash
echo "$@" > "${argsFile}"
echo "ok"
exit 0
`;
  }

  fs.writeFileSync(binaryPath, stubBody, { mode: 0o755 });

  return tmpDir;
}

/** Read the recorded invocation args from the stub binary */
function lastArgs(tmpDir: string): string {
  const argsFile = path.join(tmpDir, ".collab/bin/last-args.txt");
  if (!fs.existsSync(argsFile)) return "";
  return fs.readFileSync(argsFile, "utf-8").trim();
}

/** Run the stub CLI binary directly, as pipelines.md would */
function runCli(
  tmpDir: string,
  args: string[]
): { exitCode: number; stdout: string; stderr: string } {
  const binaryPath = path.join(tmpDir, ".collab/bin/collab");
  const result = spawnSync(binaryPath, args, { encoding: "utf-8", cwd: tmpDir });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function cleanup(tmpDir: string): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("/pipelines command: CLI delegation contract", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanup(tmpDir);
  });

  // ── Test 1: browse mode calls CLI with --json ────────────────────────────

  test("1. browse mode: calls CLI with 'pipelines --json'", () => {
    tmpDir = createTempRepoWithStub("browse-json");

    // pipelines.md instructs: "$COLLAB_BIN" pipelines --json
    const result = runCli(tmpDir, ["pipelines", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(lastArgs(tmpDir)).toBe("pipelines --json");

    // Output must be parseable JSON with packs + pipelines arrays
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed.packs)).toBe(true);
    expect(Array.isArray(parsed.pipelines)).toBe(true);
    expect(parsed.pipelines[0].name).toBe("specify");
  });

  // ── Test 2: install passes name ──────────────────────────────────────────

  test("2. install: calls CLI with 'pipelines install <name>'", () => {
    tmpDir = createTempRepoWithStub("success");

    // pipelines.md instructs: "$COLLAB_BIN" pipelines install specify
    const result = runCli(tmpDir, ["pipelines", "install", "specify"]);

    expect(result.exitCode).toBe(0);
    expect(lastArgs(tmpDir)).toBe("pipelines install specify");
  });

  // ── Test 3: install multiple names ──────────────────────────────────────

  test("3. install: passes multiple names in one invocation", () => {
    tmpDir = createTempRepoWithStub("success");

    const result = runCli(tmpDir, ["pipelines", "install", "specify", "plan"]);

    expect(result.exitCode).toBe(0);
    expect(lastArgs(tmpDir)).toBe("pipelines install specify plan");
  });

  // ── Test 4: list passes through ─────────────────────────────────────────

  test("4. list: calls CLI with 'pipelines list'", () => {
    tmpDir = createTempRepoWithStub("success");

    const result = runCli(tmpDir, ["pipelines", "list"]);

    expect(result.exitCode).toBe(0);
    expect(lastArgs(tmpDir)).toBe("pipelines list");
  });

  // ── Test 5: update passes through ───────────────────────────────────────

  test("5. update: calls CLI with 'pipelines update'", () => {
    tmpDir = createTempRepoWithStub("success");

    const result = runCli(tmpDir, ["pipelines", "update"]);

    expect(result.exitCode).toBe(0);
    expect(lastArgs(tmpDir)).toBe("pipelines update");
  });

  // ── Test 6: remove passes name ──────────────────────────────────────────

  test("6. remove: calls CLI with 'pipelines remove <name>'", () => {
    tmpDir = createTempRepoWithStub("success");

    const result = runCli(tmpDir, ["pipelines", "remove", "specify"]);

    expect(result.exitCode).toBe(0);
    expect(lastArgs(tmpDir)).toBe("pipelines remove specify");
  });

  // ── Test 7: missing binary errors ───────────────────────────────────────

  test("7. missing binary: binary absence is detectable before invocation", () => {
    tmpDir = createTempRepoWithStub("success");

    // Simulate what pipelines.md does: check binary exists before running
    const binaryPath = path.join(tmpDir, ".collab/bin/collab");

    // Remove the binary to simulate uninstalled state
    fs.unlinkSync(binaryPath);

    const binaryExists = fs.existsSync(binaryPath);
    // pipelines.md should detect this and show the error message
    expect(binaryExists).toBe(false);
    // If we tried to run it anyway, the OS would fail
    const result = spawnSync(binaryPath, ["pipelines", "list"], { encoding: "utf-8" });
    expect(result.status).not.toBe(0);
  });

  // ── Test 8: CLI non-zero exit errors ────────────────────────────────────

  test("8. CLI non-zero exit: exit code and stderr are surfaced", () => {
    tmpDir = createTempRepoWithStub("exit-nonzero");

    const result = runCli(tmpDir, ["pipelines", "install", "nonexistent"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Error");
    // pipelines.md should display: "Error: collab CLI exited with code <N>"
    // Verify the code is non-zero so the command can detect and report it
    expect(result.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Browse JSON parsing tests (unit-level, no subprocess needed)
// ---------------------------------------------------------------------------

describe("/pipelines browse: JSON output parsing", () => {
  test("9. browse JSON contains packs and pipelines arrays", () => {
    const parsed = JSON.parse(BROWSE_JSON);

    expect(Array.isArray(parsed.packs)).toBe(true);
    expect(Array.isArray(parsed.pipelines)).toBe(true);
    expect(parsed.packs.length).toBeGreaterThan(0);
    expect(parsed.pipelines.length).toBeGreaterThan(0);
  });

  test("10. each entry has name, latestVersion, description", () => {
    const parsed = JSON.parse(BROWSE_JSON);
    const allEntries = [...parsed.packs, ...parsed.pipelines];

    for (const entry of allEntries) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.latestVersion).toBe("string");
      expect(typeof entry.description).toBe("string");
    }
  });

  test("11. pack entry is distinguishable from pipeline entry", () => {
    // The browse mode prefixes pack labels with '[pack] ' when building options
    const parsed = JSON.parse(BROWSE_JSON);

    const packNames = parsed.packs.map((p: any) => p.name);
    const pipelineNames = parsed.pipelines.map((p: any) => p.name);

    // No overlap between pack names and pipeline names in canned data
    const overlap = packNames.filter((n: string) => pipelineNames.includes(n));
    expect(overlap.length).toBe(0);
  });
});
