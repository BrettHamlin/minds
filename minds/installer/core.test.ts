/**
 * Tests for doctor-check functions in minds/installer/core.ts.
 *
 * Scenarios:
 *   1. All-pass  — fully installed tree with executable scripts + valid config
 *   2. Missing files — directories absent → checkFilePresence fails
 *   3. Bad permissions — non-executable script → checkScriptPermissions fails
 *   4. Invalid JSON — corrupt pipeline.json → checkConfigSchema fails
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  runDoctorChecks,
  checkFilePresence,
  checkScriptPermissions,
  checkConfigSchema,
  INSTALL_DIRS,
} from "./core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "collab-doctor-test-"));
}

/** Build a minimal valid installed tree under repoRoot. */
function buildFullInstall(repoRoot: string): void {
  // Create all expected directories
  for (const dir of INSTALL_DIRS) {
    fs.mkdirSync(path.join(repoRoot, dir), { recursive: true });
  }

  // Required files
  fs.writeFileSync(path.join(repoRoot, ".claude/settings.json"), "{}");
  fs.writeFileSync(
    path.join(repoRoot, ".collab/memory/constitution.md"),
    "# Constitution\n"
  );
  fs.writeFileSync(path.join(repoRoot, ".collab/minds.json"), "[]\n");

  // A script in each executable dir, with exec permissions
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

  // Valid pipeline.json
  fs.writeFileSync(
    path.join(repoRoot, ".collab/config/pipeline.json"),
    JSON.stringify({ version: "3.1", phases: { clarify: {} } }, null, 2)
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDoctorChecks — all pass", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
    buildFullInstall(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("returns pass: true when everything is installed correctly", () => {
    const result = runDoctorChecks(tmp);
    const failing = result.checks.filter((c) => !c.pass);
    expect(failing).toEqual([]);
    expect(result.pass).toBe(true);
  });

  test("returns at least one check per category", () => {
    const result = runDoctorChecks(tmp);
    const dirs = result.checks.filter((c) => c.name.startsWith("dir:"));
    const files = result.checks.filter((c) => c.name.startsWith("file:"));
    const perms = result.checks.filter((c) => c.name.startsWith("perm:"));
    const config = result.checks.filter((c) => c.name.startsWith("config:"));
    expect(dirs.length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(0);
    expect(perms.length).toBeGreaterThan(0);
    expect(config.length).toBeGreaterThan(0);
  });
});

describe("checkFilePresence — missing files", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
    // Deliberately empty — no dirs, no files
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("all directory checks fail when nothing is installed", () => {
    const checks = checkFilePresence(tmp);
    const dirChecks = checks.filter((c) => c.name.startsWith("dir:"));
    expect(dirChecks.length).toBe(INSTALL_DIRS.length);
    expect(dirChecks.every((c) => !c.pass)).toBe(true);
  });

  test("file checks fail when required files are missing", () => {
    const checks = checkFilePresence(tmp);
    const fileChecks = checks.filter((c) => c.name.startsWith("file:"));
    expect(fileChecks.every((c) => !c.pass)).toBe(true);
  });

  test("failing checks include descriptive 'Missing' messages", () => {
    const checks = checkFilePresence(tmp);
    const failing = checks.filter((c) => !c.pass);
    expect(failing.every((c) => c.message.includes("Missing"))).toBe(true);
  });

  test("returns pass: false from runDoctorChecks when dirs are absent", () => {
    const result = runDoctorChecks(tmp);
    expect(result.pass).toBe(false);
  });
});

describe("checkScriptPermissions — bad permissions", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
    buildFullInstall(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("fails when a script is not executable", () => {
    const scriptPath = path.join(tmp, ".collab/scripts/run.sh");
    fs.chmodSync(scriptPath, 0o644); // remove exec bits

    const checks = checkScriptPermissions(tmp);
    const failing = checks.filter((c) => !c.pass);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing.some((c) => c.name.includes("run.sh"))).toBe(true);
  });

  test("failing check message mentions the mode", () => {
    const scriptPath = path.join(tmp, ".collab/scripts/run.sh");
    fs.chmodSync(scriptPath, 0o644);

    const checks = checkScriptPermissions(tmp);
    const failing = checks.filter((c) => !c.pass && c.name.includes("run.sh"));
    expect(failing.length).toBe(1);
    expect(failing[0].message).toContain("Not executable");
  });

  test("passes when all scripts are executable", () => {
    const checks = checkScriptPermissions(tmp);
    expect(checks.every((c) => c.pass)).toBe(true);
  });
});

describe("checkConfigSchema — invalid config", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp();
    buildFullInstall(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("fails when pipeline.json is missing", () => {
    fs.rmSync(path.join(tmp, ".collab/config/pipeline.json"));
    const checks = checkConfigSchema(tmp);
    expect(checks.length).toBe(1);
    expect(checks[0].pass).toBe(false);
    expect(checks[0].message).toContain("Missing pipeline config");
  });

  test("fails when pipeline.json contains invalid JSON", () => {
    fs.writeFileSync(
      path.join(tmp, ".collab/config/pipeline.json"),
      "{ not valid json }"
    );
    const checks = checkConfigSchema(tmp);
    expect(checks.length).toBe(1);
    expect(checks[0].pass).toBe(false);
    expect(checks[0].message).toContain("Invalid JSON");
  });

  test("fails when 'version' field is missing", () => {
    fs.writeFileSync(
      path.join(tmp, ".collab/config/pipeline.json"),
      JSON.stringify({ phases: { clarify: {} } })
    );
    const checks = checkConfigSchema(tmp);
    const versionCheck = checks.find((c) => c.name.includes("version"));
    expect(versionCheck).toBeDefined();
    expect(versionCheck!.pass).toBe(false);
    expect(versionCheck!.message).toContain("version");
  });

  test("fails when 'phases' field is missing", () => {
    fs.writeFileSync(
      path.join(tmp, ".collab/config/pipeline.json"),
      JSON.stringify({ version: "3.1" })
    );
    const checks = checkConfigSchema(tmp);
    const phasesCheck = checks.find((c) => c.name.includes("phases"));
    expect(phasesCheck).toBeDefined();
    expect(phasesCheck!.pass).toBe(false);
    expect(phasesCheck!.message).toContain("phases");
  });

  test("passes with a valid pipeline.json", () => {
    const checks = checkConfigSchema(tmp);
    expect(checks.every((c) => c.pass)).toBe(true);
  });
});
