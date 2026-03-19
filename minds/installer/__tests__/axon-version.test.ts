/**
 * Tests for BRE-575: Axon version pinning and upgrade path
 *
 * Covers:
 * - semver comparison (compareSemver)
 * - getPinnedVersionInfo (version + minVersion from JSON)
 * - checkAxonVersion logic with mocked binary execution
 */

import { describe, test, expect } from "bun:test";
import {
  compareSemver,
  parseSemver,
  checkAxonVersion,
  getPinnedVersionInfo,
  type VersionCheck,
} from "../axon-installer.js";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// parseSemver
// ---------------------------------------------------------------------------
describe("parseSemver", () => {
  test("parses standard version", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  test("parses zero version", () => {
    expect(parseSemver("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  test("parses large numbers", () => {
    expect(parseSemver("10.200.3000")).toEqual({ major: 10, minor: 200, patch: 3000 });
  });

  test("returns null for invalid input", () => {
    expect(parseSemver("not-a-version")).toBeNull();
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// compareSemver
// ---------------------------------------------------------------------------
describe("compareSemver", () => {
  test("equal versions return 0", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });

  test("major version difference", () => {
    expect(compareSemver("2.0.0", "1.0.0")).toBe(1);
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
  });

  test("minor version difference", () => {
    expect(compareSemver("1.2.0", "1.1.0")).toBe(1);
    expect(compareSemver("1.1.0", "1.2.0")).toBe(-1);
  });

  test("patch version difference", () => {
    expect(compareSemver("1.0.2", "1.0.1")).toBe(1);
    expect(compareSemver("1.0.1", "1.0.2")).toBe(-1);
  });

  test("major takes precedence over minor", () => {
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
  });

  test("minor takes precedence over patch", () => {
    expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
  });

  test("throws on invalid version", () => {
    expect(() => compareSemver("bad", "1.0.0")).toThrow();
    expect(() => compareSemver("1.0.0", "bad")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getPinnedVersionInfo
// ---------------------------------------------------------------------------
describe("getPinnedVersionInfo", () => {
  test("reads version and minVersion from JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-ver-"));
    writeFileSync(
      join(dir, "axon-version.json"),
      JSON.stringify({ version: "0.2.0", minVersion: "0.1.0" })
    );
    const info = getPinnedVersionInfo(dir);
    expect(info).toEqual({ version: "0.2.0", minVersion: "0.1.0" });
  });

  test("defaults minVersion to version when not specified", () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-ver-"));
    writeFileSync(
      join(dir, "axon-version.json"),
      JSON.stringify({ version: "0.3.0" })
    );
    const info = getPinnedVersionInfo(dir);
    expect(info).toEqual({ version: "0.3.0", minVersion: "0.3.0" });
  });

  test("returns null when file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-ver-"));
    expect(getPinnedVersionInfo(dir)).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-ver-"));
    writeFileSync(join(dir, "axon-version.json"), "not json");
    expect(getPinnedVersionInfo(dir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkAxonVersion
// ---------------------------------------------------------------------------
describe("checkAxonVersion", () => {
  function makeFakeBinary(dir: string, versionOutput: string): string {
    const binDir = join(dir, ".minds", "bin");
    mkdirSync(binDir, { recursive: true });
    const binPath = join(binDir, "axon");
    writeFileSync(binPath, `#!/bin/sh\necho "${versionOutput}"\n`);
    chmodSync(binPath, 0o755);
    return binPath;
  }

  function writeVersionJson(dir: string, data: Record<string, string>): void {
    // getPinnedVersionInfo reads from the installer directory, but checkAxonVersion
    // accepts the repo root and an installer dir. We'll place version json in a subdir.
    const installerDir = join(dir, "installer");
    mkdirSync(installerDir, { recursive: true });
    writeFileSync(join(installerDir, "axon-version.json"), JSON.stringify(data));
  }

  test("returns not installed when binary does not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-check-"));
    writeVersionJson(dir, { version: "0.1.0", minVersion: "0.1.0" });
    const result = await checkAxonVersion(dir, join(dir, "installer"));
    expect(result.installed).toBeNull();
    expect(result.needsUpgrade).toBe(true);
    expect(result.upgradeAvailable).toBe(false);
  });

  test("returns up to date when installed matches pinned", async () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-check-"));
    makeFakeBinary(dir, "axon 0.1.0");
    writeVersionJson(dir, { version: "0.1.0", minVersion: "0.1.0" });
    const result = await checkAxonVersion(dir, join(dir, "installer"));
    expect(result.installed).toBe("0.1.0");
    expect(result.pinned).toBe("0.1.0");
    expect(result.needsUpgrade).toBe(false);
    expect(result.upgradeAvailable).toBe(false);
  });

  test("needsUpgrade when installed < minVersion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-check-"));
    makeFakeBinary(dir, "axon 0.0.9");
    writeVersionJson(dir, { version: "0.2.0", minVersion: "0.1.0" });
    const result = await checkAxonVersion(dir, join(dir, "installer"));
    expect(result.installed).toBe("0.0.9");
    expect(result.needsUpgrade).toBe(true);
    expect(result.upgradeAvailable).toBe(false); // needsUpgrade takes precedence
  });

  test("upgradeAvailable when installed >= minVersion but < pinned", async () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-check-"));
    makeFakeBinary(dir, "axon 0.1.0");
    writeVersionJson(dir, { version: "0.2.0", minVersion: "0.1.0" });
    const result = await checkAxonVersion(dir, join(dir, "installer"));
    expect(result.installed).toBe("0.1.0");
    expect(result.needsUpgrade).toBe(false);
    expect(result.upgradeAvailable).toBe(true);
  });

  test("handles version output with extra text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-check-"));
    makeFakeBinary(dir, "axon 1.2.3 (built 2025-01-01)");
    writeVersionJson(dir, { version: "1.2.3", minVersion: "1.0.0" });
    const result = await checkAxonVersion(dir, join(dir, "installer"));
    expect(result.installed).toBe("1.2.3");
    expect(result.needsUpgrade).toBe(false);
    expect(result.upgradeAvailable).toBe(false);
  });

  test("returns installed null when binary fails to execute", async () => {
    const dir = mkdtempSync(join(tmpdir(), "axon-check-"));
    const binDir = join(dir, ".minds", "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "axon"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(binDir, "axon"), 0o755);
    writeVersionJson(dir, { version: "0.1.0", minVersion: "0.1.0" });
    const result = await checkAxonVersion(dir, join(dir, "installer"));
    expect(result.installed).toBeNull();
    expect(result.needsUpgrade).toBe(true);
  });
});
