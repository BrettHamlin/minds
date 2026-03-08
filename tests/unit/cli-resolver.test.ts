/**
 * Unit tests for src/cli/lib/cli-resolver.ts
 * Uses mock $PATH via detectVersion override patterns.
 * Covers: satisfied, too-old, missing, unknown-version, deduplication.
 */

import { describe, test, expect, mock, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  checkCli,
  checkAllClis,
  getBlockingClis,
  formatCliResult,
  detectVersion,
  installCli,
  resolveCliDeps,
  CLI_STRATEGIES,
} from "../../minds/cli/lib/cli-resolver.js";
import { removePipelineFromClis } from "../../minds/cli/lib/state.js";
import type { CliDependency } from "../../minds/cli/types/index.js";

// ─── checkCli ────────────────────────────────────────────────────────────────

describe("checkCli — using real system CLIs (bun is always present)", () => {
  test("bun is installed and satisfies >=1.0.0", () => {
    const dep: CliDependency = {
      name: "bun",
      version: ">=1.0.0",
      required: true,
    };
    const result = checkCli(dep);
    // bun must be installed for this test to run, so it should be satisfied
    expect(result.name).toBe("bun");
    expect(result.status === "satisfied" || result.status === "unknown-version").toBe(true);
    expect(result.requiredRange).toBe(">=1.0.0");
    expect(result.required).toBe(true);
  });

  test("missing CLI returns missing status", () => {
    const dep: CliDependency = {
      name: "definitely-not-installed-xyz-123",
      version: ">=1.0.0",
      required: true,
    };
    const result = checkCli(dep);
    expect(result.status).toBe("missing");
    expect(result.required).toBe(true);
  });

  test("non-required missing CLI still reports missing", () => {
    const dep: CliDependency = {
      name: "definitely-not-installed-xyz-123",
      version: ">=1.0.0",
      required: false,
    };
    const result = checkCli(dep);
    expect(result.status).toBe("missing");
    expect(result.required).toBe(false);
  });
});

// ─── checkAllClis ────────────────────────────────────────────────────────────

describe("checkAllClis", () => {
  test("returns results for each unique dep", () => {
    const deps: CliDependency[] = [
      { name: "bun", version: ">=1.0.0", required: true },
      { name: "definitely-not-installed-xyz", version: ">=1.0.0", required: false },
    ];
    const results = checkAllClis(deps);
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.name);
    expect(names).toContain("bun");
    expect(names).toContain("definitely-not-installed-xyz");
  });

  test("deduplicates same CLI appearing twice", () => {
    const deps: CliDependency[] = [
      { name: "bun", version: ">=1.0.0", required: false },
      { name: "bun", version: ">=1.0.0", required: true },
    ];
    const results = checkAllClis(deps);
    const bunResults = results.filter((r) => r.name === "bun");
    expect(bunResults).toHaveLength(1);
    expect(bunResults[0].required).toBe(true);
  });

  test("multiple pipelines requiring same CLI — deduplicate", () => {
    const deps: CliDependency[] = [
      { name: "git", version: ">=2.0.0", required: true },
      { name: "git", version: ">=2.0.0", required: true },
      { name: "jq", version: ">=1.6.0", required: false },
    ];
    const results = checkAllClis(deps);
    const gitResults = results.filter((r) => r.name === "git");
    expect(gitResults).toHaveLength(1);
  });
});

// ─── getBlockingClis ─────────────────────────────────────────────────────────

describe("getBlockingClis", () => {
  test("returns only required unsatisfied CLIs", () => {
    const results = [
      { name: "bun", status: "satisfied" as const, requiredRange: ">=1.0.0", required: true },
      {
        name: "xyz",
        status: "missing" as const,
        requiredRange: ">=1.0.0",
        required: true,
      },
      {
        name: "abc",
        status: "too-old" as const,
        installedVersion: "0.5.0",
        requiredRange: ">=1.0.0",
        required: false,
      },
    ];

    const blocking = getBlockingClis(results);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].name).toBe("xyz");
  });

  test("returns empty array when all required CLIs satisfied", () => {
    const results = [
      { name: "bun", status: "satisfied" as const, requiredRange: ">=1.0.0", required: true },
    ];
    expect(getBlockingClis(results)).toHaveLength(0);
  });

  test("non-required too-old CLI is not blocking", () => {
    const results = [
      {
        name: "xyz",
        status: "too-old" as const,
        installedVersion: "0.5.0",
        requiredRange: ">=1.0.0",
        required: false,
      },
    ];
    expect(getBlockingClis(results)).toHaveLength(0);
  });
});

// ─── formatCliResult ─────────────────────────────────────────────────────────

describe("formatCliResult", () => {
  test("formats satisfied result", () => {
    const result = {
      name: "bun",
      status: "satisfied" as const,
      installedVersion: "1.2.3",
      requiredRange: ">=1.0.0",
      required: true,
    };
    const line = formatCliResult(result);
    expect(line).toContain("✓");
    expect(line).toContain("bun");
    expect(line).toContain("1.2.3");
  });

  test("formats missing result with install hint", () => {
    const result = {
      name: "jq",
      status: "missing" as const,
      requiredRange: ">=1.6.0",
      required: true,
      installHint: "brew install jq",
    };
    const line = formatCliResult(result);
    expect(line).toContain("✗");
    expect(line).toContain("NOT FOUND");
    expect(line).toContain("brew install jq");
  });

  test("formats too-old result", () => {
    const result = {
      name: "git",
      status: "too-old" as const,
      installedVersion: "1.5.0",
      requiredRange: ">=2.0.0",
      required: true,
      installHint: "brew upgrade git",
    };
    const line = formatCliResult(result);
    expect(line).toContain("✗");
    expect(line).toContain("TOO OLD");
    expect(line).toContain("1.5.0");
  });

  test("formats unknown-version result", () => {
    const result = {
      name: "mytool",
      status: "unknown-version" as const,
      installedVersion: "unknown",
      requiredRange: ">=1.0.0",
      required: false,
    };
    const line = formatCliResult(result);
    expect(line).toContain("?");
    expect(line).toContain("undetectable");
  });
});

// ─── checkCli with mocked execFn ─────────────────────────────────────────────
// These tests use injectable execFn to simulate CLI detection without needing
// actual CLIs on the test machine.

describe("checkCli — mocked execFn", () => {
  test("1. CLI found, version satisfies constraint", () => {
    const mockExec = (cmd: string): string => {
      if (cmd === "jq --version") return "jq-1.7.1\n";
      throw new Error("command not found");
    };

    const dep: CliDependency = { name: "jq", version: ">=1.6", required: true };
    const result = checkCli(dep, mockExec);

    expect(result.status).toBe("satisfied");
    expect(result.installedVersion).toBe("1.7.1");
    expect(result.name).toBe("jq");
  });

  test("2. CLI found, version too old", () => {
    const mockExec = (cmd: string): string => {
      if (cmd === "jq --version") return "jq-1.5\n";
      throw new Error("command not found");
    };

    const dep: CliDependency = { name: "jq", version: ">=1.6", required: true };
    const result = checkCli(dep, mockExec);

    expect(result.status).toBe("too-old");
    expect(result.installedVersion).toBe("1.5.0");
  });

  test("3. CLI not found — returns missing", () => {
    const mockExec = (_cmd: string): string => {
      throw new Error("command not found");
    };

    const dep: CliDependency = { name: "jq", version: ">=1.6", required: true };
    const result = checkCli(dep, mockExec);

    expect(result.status).toBe("missing");
    expect(result.installedVersion).toBeUndefined();
  });

  test("4. Non-installable CLI missing — strategy has installCmd: null", () => {
    const mockExec = (_cmd: string): string => {
      throw new Error("command not found");
    };

    const dep: CliDependency = { name: "xcodebuild", version: ">=14.0", required: true };
    const result = checkCli(dep, mockExec);

    expect(result.status).toBe("missing");
    // Verify CLI_STRATEGIES marks it as non-installable
    expect(CLI_STRATEGIES["xcodebuild"].installCmd).toBeNull();
    expect(CLI_STRATEGIES["xcodebuild"].instructions).toContain("Xcode");
  });
});

// ─── Unknown CLI warning ──────────────────────────────────────────────────────

describe("resolveCliDeps — unknown CLI", () => {
  test("5. Unknown CLI: warning logged, does not block (required: false in result)", () => {
    const mockExec = (_cmd: string): string => {
      throw new Error("command not found");
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-resolver-"));
    fs.mkdirSync(path.join(tmpDir, ".collab/state"), { recursive: true });
    const statePath = path.join(tmpDir, ".collab/state/installed-pipelines.json");

    const result = resolveCliDeps(
      { "definitely-unknown-foo-cli": ">=1.0.0" },
      "test-pipeline",
      tmpDir,
      { execFn: mockExec, statePath }
    );

    // Unknown CLI should not block success (warn and proceed)
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("definitely-unknown-foo-cli");
    // required: false because we can't validate it
    expect(result.results[0].required).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ─── Dedup + requiredBy state management ─────────────────────────────────────

describe("resolveCliDeps — deduplication and requiredBy", () => {
  test("6. CLI already tracked in state — updates requiredBy without re-installing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-resolver-dedup-"));
    fs.mkdirSync(path.join(tmpDir, ".collab/state"), { recursive: true });
    const statePath = path.join(tmpDir, ".collab/state/installed-pipelines.json");

    // Pre-populate state with jq already tracked by "plan"
    const initialState = {
      version: "1",
      installedAt: new Date().toISOString(),
      pipelines: {},
      clis: {
        jq: { name: "jq", version: "1.7.1", installedAt: new Date().toISOString(), requiredBy: ["plan"] },
      },
    };
    fs.writeFileSync(statePath, JSON.stringify(initialState, null, 2));

    // execFn should NOT be called because dedup short-circuits
    let execCalled = false;
    const mockExec = (_cmd: string): string => {
      execCalled = true;
      return "jq-1.7.1";
    };

    const result = resolveCliDeps(
      { jq: ">=1.6" },
      "specify",
      tmpDir,
      { execFn: mockExec, statePath }
    );

    expect(result.success).toBe(true);
    expect(execCalled).toBe(false); // dedup skipped detection

    // State updated: requiredBy now includes both "plan" and "specify"
    const updatedState = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    expect(updatedState.clis.jq.requiredBy).toContain("plan");
    expect(updatedState.clis.jq.requiredBy).toContain("specify");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("7. Remove pipeline: requiredBy updated to exclude removed pipeline", () => {
    const state = {
      version: "1" as const,
      installedAt: new Date().toISOString(),
      pipelines: {},
      clis: {
        jq: {
          name: "jq", version: "1.7.1", installedAt: new Date().toISOString(),
          requiredBy: ["plan", "specify"],
        },
      },
    };

    const updated = removePipelineFromClis(state, "specify");
    expect(updated.clis["jq"].requiredBy).toEqual(["plan"]);
    expect(updated.clis["jq"].requiredBy).not.toContain("specify");
  });

  test("8. Remove last pipeline for CLI — requiredBy becomes empty", () => {
    const state = {
      version: "1" as const,
      installedAt: new Date().toISOString(),
      pipelines: {},
      clis: {
        bun: {
          name: "bun", version: "1.2.0", installedAt: new Date().toISOString(),
          requiredBy: ["specify"],
        },
      },
    };

    const updated = removePipelineFromClis(state, "specify");
    expect(updated.clis["bun"].requiredBy).toEqual([]);
  });
});

// ─── checkAllClis with mixed results ─────────────────────────────────────────

describe("checkAllClis — mixed results via mocked execFn", () => {
  test("9. checkAllClis with 2 satisfied, 1 missing returns correct statuses", () => {
    const mockExec = (cmd: string): string => {
      if (cmd === "bun --version") return "1.2.3\n";
      if (cmd === "jq --version") return "jq-1.7.1\n";
      throw new Error("command not found"); // git not found
    };

    const deps: CliDependency[] = [
      { name: "bun", version: ">=1.0.0", required: true },
      { name: "jq", version: ">=1.6", required: false },
      { name: "git", version: ">=2.0.0", required: true },
    ];

    const results = checkAllClis(deps, mockExec);
    expect(results).toHaveLength(3);

    const bunResult = results.find((r) => r.name === "bun")!;
    expect(bunResult.status).toBe("satisfied");

    const jqResult = results.find((r) => r.name === "jq")!;
    expect(jqResult.status).toBe("satisfied");

    const gitResult = results.find((r) => r.name === "git")!;
    expect(gitResult.status).toBe("missing");
  });
});

// ─── resolveCliDeps full flow ─────────────────────────────────────────────────

describe("resolveCliDeps — install flow", () => {
  test("10. full flow: 1 satisfied, 1 installable — install succeeds", () => {
    let installCalled = false;
    let jqInstalled = false;
    // Stateful mock: jq missing initially, present after brew install jq
    const mockExec = (cmd: string): string => {
      if (cmd === "bun --version") return "1.2.3\n";
      if (cmd === "jq --version") {
        if (jqInstalled) return "jq-1.7.1\n";
        throw new Error("jq: command not found");
      }
      if (cmd === "brew install jq") {
        installCalled = true;
        jqInstalled = true;
        return "";
      }
      throw new Error(`unexpected: ${cmd}`);
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-resolve-flow-"));
    fs.mkdirSync(path.join(tmpDir, ".collab/state"), { recursive: true });
    const statePath = path.join(tmpDir, ".collab/state/installed-pipelines.json");

    const result = resolveCliDeps(
      { bun: ">=1.0.0", jq: ">=1.6" },
      "specify",
      tmpDir,
      { execFn: mockExec, statePath }
    );

    expect(result.success).toBe(true);
    expect(installCalled).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("11. resolveCliDeps — install fails returns success: false", () => {
    const mockExec = (cmd: string): string => {
      if (cmd === "bun --version") return "1.2.3\n";
      // jq not found, install also fails
      if (cmd === "brew install jq") throw new Error("brew: command not found");
      throw new Error(`unexpected: ${cmd}`);
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-resolve-fail-"));
    fs.mkdirSync(path.join(tmpDir, ".collab/state"), { recursive: true });
    const statePath = path.join(tmpDir, ".collab/state/installed-pipelines.json");

    const result = resolveCliDeps(
      { bun: ">=1.0.0", jq: ">=1.6" },
      "specify",
      tmpDir,
      { execFn: mockExec, statePath }
    );

    expect(result.success).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
