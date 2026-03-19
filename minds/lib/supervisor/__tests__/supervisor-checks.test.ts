/**
 * supervisor-checks.test.ts — Tests for loadStandards and deterministic
 * check utilities.
 *
 * Note: runDeterministicChecksDefault spawns git and bun subprocesses,
 * making it impractical to unit test without a real repo. It is tested
 * via integration tests in mind-supervisor-integration.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { loadStandards, isDirFullyOwned } from "../supervisor-checks.ts";
import { makeTestTmpDir } from "./test-helpers.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTestTmpDir("supervisor-checks");
  // Create minds/cli/ so resolveMindsDir detects this as a dev repo
  mkdirSync(join(tmpDir, "minds", "cli"), { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// loadStandards
// ---------------------------------------------------------------------------

describe("loadStandards", () => {
  test("returns STANDARDS.md content when file exists", () => {
    const standardsContent = "# Engineering Standards\n\nAll exports must have tests.\n";
    writeFileSync(join(tmpDir, "minds", "STANDARDS.md"), standardsContent);

    const result = loadStandards(tmpDir);
    expect(result).toBe(standardsContent);
  });

  test("concatenates STANDARDS.md and STANDARDS-project.md when both exist", () => {
    const baseContent = "# Base Standards\n\nNo dead code.\n";
    const projectContent = "# Project Standards\n\nUse TypeScript only.\n";
    writeFileSync(join(tmpDir, "minds", "STANDARDS.md"), baseContent);
    writeFileSync(join(tmpDir, "minds", "STANDARDS-project.md"), projectContent);

    const result = loadStandards(tmpDir);
    expect(result).toContain("Base Standards");
    expect(result).toContain("No dead code.");
    expect(result).toContain("Project Standards");
    expect(result).toContain("Use TypeScript only.");
    // Verify they are concatenated with a separator
    expect(result).toBe(baseContent + "\n\n" + projectContent);
  });

  test("returns empty string when neither file exists", () => {
    const result = loadStandards(tmpDir);
    expect(result).toBe("");
  });

  test("handles only STANDARDS-project.md existing (no leading whitespace)", () => {
    const projectContent = "# Project-Only Standards\n\nBun over npm.\n";
    writeFileSync(join(tmpDir, "minds", "STANDARDS-project.md"), projectContent);

    const result = loadStandards(tmpDir);
    expect(result).toBe(projectContent);
    expect(result).not.toStartWith("\n\n");
  });
});

// ---------------------------------------------------------------------------
// isDirFullyOwned
// ---------------------------------------------------------------------------

describe("isDirFullyOwned", () => {
  test("directory under a glob-suffixed owns_files entry is fully owned", () => {
    expect(isDirFullyOwned("tests/core/lib", ["tests/core/**"])).toBe(true);
  });

  test("directory under a trailing-slash owns_files entry is fully owned", () => {
    expect(isDirFullyOwned("packages/core/lib", ["packages/core/"])).toBe(true);
  });

  test("directory under a bare directory owns_files entry is fully owned", () => {
    expect(isDirFullyOwned("packages/core/lib", ["packages/core"])).toBe(true);
  });

  test("directory containing a specific file entry is NOT fully owned", () => {
    // Mind owns tests/modules/blueprint/api.test.ts but NOT the whole directory
    expect(isDirFullyOwned("tests/modules/blueprint", ["tests/modules/blueprint/api.test.ts"])).toBe(false);
  });

  test("directory not mentioned at all in owns_files is NOT fully owned", () => {
    expect(isDirFullyOwned("tests/integration", ["packages/core/**", "tests/core/**"])).toBe(false);
  });

  test("returns true when ownsFiles is empty (no boundary defined)", () => {
    expect(isDirFullyOwned("any/dir", [])).toBe(true);
  });

  test("exact directory match with glob", () => {
    expect(isDirFullyOwned("tests/core", ["tests/core/**"])).toBe(true);
  });

  test("sibling directory is not owned", () => {
    expect(isDirFullyOwned("tests/integration", ["tests/core/**"])).toBe(false);
  });

  test("handles .minds/ normalization", () => {
    expect(isDirFullyOwned(".minds/transport", ["minds/transport/"])).toBe(true);
  });

  test("multiple owns_files entries — matches if any covers the dir", () => {
    expect(isDirFullyOwned("tests/core/lib", ["packages/core/**", "tests/core/**"])).toBe(true);
  });

  test("specific file entry does not make parent directory owned", () => {
    // Even with multiple entries, a specific file does not grant directory ownership
    expect(isDirFullyOwned("tests/modules/blueprint", [
      "packages/core/**",
      "tests/core/**",
      "tests/helpers/**",
      "tests/modules/blueprint/api.test.ts",
    ])).toBe(false);
  });
});
