/**
 * Tests for the `collab doctor` CLI subcommand handler.
 *
 * Scenarios:
 *   1. Passing checks — full install tree → human-readable ✓ lines, "All N check(s) passed."
 *   2. Failing checks — empty dir → human-readable ✗ lines, exit code 1
 *   3. --json flag — JSON output; exit 0 on pass, exit 1 on fail
 *   4. --help flag — printDoctorHelp() emits usage text
 */

import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { doctorCommand, printDoctorHelp } from "./doctor";
import { INSTALL_DIRS } from "../../installer/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "collab-doctor-cli-test-"));
}

/** Mirror of buildFullInstall from core.test.ts — a minimal fully-installed tree. */
function buildFullInstall(repoRoot: string): void {
  for (const dir of INSTALL_DIRS) {
    fs.mkdirSync(path.join(repoRoot, dir), { recursive: true });
  }

  fs.writeFileSync(path.join(repoRoot, ".claude/settings.json"), "{}");
  fs.writeFileSync(
    path.join(repoRoot, ".collab/memory/constitution.md"),
    "# Constitution\n"
  );

  const scriptTargets: Array<[string, string]> = [
    [".collab/scripts", "run.sh"],
    [".collab/handlers", "handler.ts"],
    [".claude/commands", "cmd.sh"],
  ];
  for (const [dir, name] of scriptTargets) {
    const full = path.join(repoRoot, dir, name);
    fs.writeFileSync(full, "#!/bin/sh\n");
    fs.chmodSync(full, 0o755);
  }

  fs.writeFileSync(
    path.join(repoRoot, ".collab/config/pipeline.json"),
    JSON.stringify({ version: "3.1", phases: { clarify: {} } }, null, 2)
  );
}

// ---------------------------------------------------------------------------
// Capture stdout/stderr helpers
// ---------------------------------------------------------------------------

interface Output {
  stdout: string[];
  stderr: string[];
}

function captureOutput(fn: () => void): Output {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
  const errSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  });

  try {
    fn();
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
  }

  return { stdout, stderr };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("doctorCommand — passing checks (human-readable)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
    buildFullInstall(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("prints ✓ lines for all checks", () => {
    const { stdout } = captureOutput(() => {
      doctorCommand({ repoRoot: tmp });
    });

    const checkLines = stdout.filter((l) => l.trim().startsWith("✓") || l.trim().startsWith("✗"));
    expect(checkLines.length).toBeGreaterThan(0);
    expect(checkLines.every((l) => l.includes("✓"))).toBe(true);
  });

  test("prints summary line indicating all checks passed", () => {
    const { stdout } = captureOutput(() => {
      doctorCommand({ repoRoot: tmp });
    });

    const summary = stdout.find((l) => l.includes("check(s) passed"));
    expect(summary).toBeDefined();
    expect(summary).toContain("All");
  });

  test("does not print any ✗ lines", () => {
    const { stdout } = captureOutput(() => {
      doctorCommand({ repoRoot: tmp });
    });

    const failLines = stdout.filter((l) => l.includes("✗"));
    expect(failLines.length).toBe(0);
  });
});

describe("doctorCommand — failing checks (human-readable)", () => {
  let tmp: string;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmp = mkTmp();
    // Deliberately empty — no install
    exitSpy = spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("prints ✗ lines when checks fail", () => {
    const { stdout } = captureOutput(() => {
      try {
        doctorCommand({ repoRoot: tmp });
      } catch {
        // swallow exit
      }
    });

    const failLines = stdout.filter((l) => l.includes("✗"));
    expect(failLines.length).toBeGreaterThan(0);
  });

  test("calls process.exit(1) when checks fail", () => {
    let threw = false;
    captureOutput(() => {
      try {
        doctorCommand({ repoRoot: tmp });
      } catch (e) {
        threw = true;
        expect((e as Error).message).toContain("process.exit(1)");
      }
    });
    expect(threw).toBe(true);
  });

  test("prints stderr summary line with failure count", () => {
    const { stderr } = captureOutput(() => {
      try {
        doctorCommand({ repoRoot: tmp });
      } catch {
        // swallow exit
      }
    });

    const summary = stderr.find((l) => l.includes("check(s) failed"));
    expect(summary).toBeDefined();
  });
});

describe("doctorCommand — --json flag", () => {
  let tmp: string;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmp = mkTmp();
    exitSpy = spyOn(process, "exit").mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("outputs valid JSON when checks pass", () => {
    buildFullInstall(tmp);

    const { stdout } = captureOutput(() => {
      doctorCommand({ repoRoot: tmp, json: true });
    });

    const json = JSON.parse(stdout.join("\n"));
    expect(json).toHaveProperty("pass", true);
    expect(Array.isArray(json.checks)).toBe(true);
  });

  test("JSON output has correct shape (pass, checks[])", () => {
    buildFullInstall(tmp);

    const { stdout } = captureOutput(() => {
      doctorCommand({ repoRoot: tmp, json: true });
    });

    const json = JSON.parse(stdout.join("\n"));
    expect(json).toHaveProperty("pass");
    expect(json).toHaveProperty("checks");
    expect(json.checks[0]).toHaveProperty("name");
    expect(json.checks[0]).toHaveProperty("pass");
    expect(json.checks[0]).toHaveProperty("message");
  });

  test("outputs JSON and exits 1 when checks fail", () => {
    // tmp is empty — all checks fail
    let threw = false;
    const { stdout } = captureOutput(() => {
      try {
        doctorCommand({ repoRoot: tmp, json: true });
      } catch (e) {
        threw = true;
        expect((e as Error).message).toContain("process.exit(1)");
      }
    });

    expect(threw).toBe(true);
    const json = JSON.parse(stdout.join("\n"));
    expect(json.pass).toBe(false);
  });

  test("does not print human-readable lines when --json is set", () => {
    buildFullInstall(tmp);

    const { stdout } = captureOutput(() => {
      doctorCommand({ repoRoot: tmp, json: true });
    });

    // All output should be valid JSON; no ✓/✗ check lines
    const checkLines = stdout.filter((l) => l.trim().startsWith("✓") || l.trim().startsWith("✗"));
    expect(checkLines.length).toBe(0);
  });
});

describe("printDoctorHelp — --help flag", () => {
  test("prints usage information", () => {
    const { stdout } = captureOutput(() => {
      printDoctorHelp();
    });

    const combined = stdout.join("\n");
    expect(combined).toContain("collab doctor");
    expect(combined).toContain("--json");
    expect(combined).toContain("--help");
  });

  test("includes --path option in help text", () => {
    const { stdout } = captureOutput(() => {
      printDoctorHelp();
    });

    const combined = stdout.join("\n");
    expect(combined).toContain("--path");
  });
});
