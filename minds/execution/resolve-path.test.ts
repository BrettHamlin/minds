/**
 * Tests for resolve-path.ts CLI — deterministic path resolution.
 *
 * Tests that the CLI outputs correct paths for each path type.
 * Feature-dir-dependent types (findings, resolutions) are tested with a
 * temp specs directory so findFeatureDir can locate them.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SCRIPT = path.resolve(import.meta.dir, "resolve-path.ts");

function runCLI(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bun", SCRIPT, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
  });
  return {
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
    exitCode: result.exitCode ?? 1,
  };
}

describe("resolve-path: registry", () => {
  test("outputs registry path for a ticket ID", () => {
    const { stdout, exitCode } = runCLI(["BRE-123", "registry"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pipeline-registry");
    expect(stdout).toContain("BRE-123.json");
  });

  test("path ends with the correct filename", () => {
    const { stdout } = runCLI(["PROJ-42", "registry"]);
    expect(stdout.endsWith("PROJ-42.json")).toBe(true);
  });
});

describe("resolve-path: signal-queue", () => {
  test("outputs signal-queue path for a ticket ID", () => {
    const { stdout, exitCode } = runCLI(["BRE-123", "signal-queue"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("signal-queue");
    expect(stdout).toContain("BRE-123.json");
  });

  test("path ends with the correct filename", () => {
    const { stdout } = runCLI(["PROJ-99", "signal-queue"]);
    expect(stdout.endsWith("PROJ-99.json")).toBe(true);
  });
});

describe("resolve-path: findings and resolutions", () => {
  let tmpDir: string;
  let specsDir: string;
  let featureDir: string;

  beforeAll(() => {
    // Create a temp repo root with a specs/{ticket-dir} structure
    // so findFeatureDir can locate it by ticket ID
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collab-resolve-path-"));
    specsDir = path.join(tmpDir, "specs");
    featureDir = path.join(specsDir, "BRE-428-path-utils");
    fs.mkdirSync(featureDir, { recursive: true });
    // Write metadata.json so findFeatureDir can find by ticket_id field
    fs.writeFileSync(
      path.join(featureDir, "metadata.json"),
      JSON.stringify({ ticket_id: "BRE-428" }),
    );
    // Also initialize a bare git repo so getRepoRoot() returns tmpDir
    Bun.spawnSync(["git", "init"], { cwd: tmpDir });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("findings: outputs findings path with correct phase and round", () => {
    const { stdout, exitCode } = runCLI(["BRE-428", "findings", "clarify", "1"], {
      cwd: tmpDir,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("findings");
    expect(stdout).toContain("clarify-round-1.json");
  });

  test("findings: defaults to round 1 when not specified", () => {
    const { stdout, exitCode } = runCLI(["BRE-428", "findings", "analyze"], {
      cwd: tmpDir,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("analyze-round-1.json");
  });

  test("findings: handles round 2", () => {
    const { stdout, exitCode } = runCLI(["BRE-428", "findings", "spec_critique", "2"], {
      cwd: tmpDir,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("spec_critique-round-2.json");
  });

  test("resolutions: outputs resolutions path with correct phase and round", () => {
    const { stdout, exitCode } = runCLI(["BRE-428", "resolutions", "clarify", "1"], {
      cwd: tmpDir,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("resolutions");
    expect(stdout).toContain("clarify-round-1.json");
  });

  test("resolutions: spec_critique phase", () => {
    const { stdout, exitCode } = runCLI(["BRE-428", "resolutions", "spec_critique", "1"], {
      cwd: tmpDir,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("spec_critique-round-1.json");
  });
});

describe("resolve-path: error cases", () => {
  test("exits 1 with no args", () => {
    const { exitCode, stderr } = runCLI([]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage");
  });

  test("exits 1 with only ticket ID", () => {
    const { exitCode, stderr } = runCLI(["BRE-123"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage");
  });

  test("exits 1 for unknown path type", () => {
    const { exitCode, stderr } = runCLI(["BRE-123", "unknown-type"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown path type");
  });

  test("exits 1 for findings without phase arg", () => {
    const { exitCode, stderr } = runCLI(["BRE-123", "findings"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage");
  });

  test("exits 1 for resolutions without phase arg", () => {
    const { exitCode, stderr } = runCLI(["BRE-123", "resolutions"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage");
  });

  test("exits 1 for findings when ticket not found", () => {
    const { exitCode, stderr } = runCLI(["NONEXISTENT-999", "findings", "clarify", "1"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });
});
