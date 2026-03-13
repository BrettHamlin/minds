/**
 * boundary-check-multirepo.test.ts — Tests for repo-qualified owns_files in boundary check (MR-014).
 *
 * Verifies:
 * - Repo-prefixed owns_files match repo-relative diff paths
 * - Bare paths still work
 * - Mixed prefixed/bare works
 * - Custom infraExclusions merged with defaults
 * - requireBoundary + empty ownsFiles still hard-errors
 */

import { describe, test, expect } from "bun:test";
import { checkBoundary } from "../boundary-check.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDiff(...files: string[]): string {
  return files
    .map((f) => `diff --git a/${f} b/${f}\nindex abc..def 100644\n--- a/${f}\n+++ b/${f}\n@@ -1 +1,2 @@\n+change`)
    .join("\n");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("checkBoundary — repo-qualified owns_files (MR-014)", () => {
  test("backend:src/api/** matches src/api/handler.ts → no violation", () => {
    const diff = makeDiff("src/api/handler.ts");
    const result = checkBoundary(diff, ["backend:src/api/**"], "api");
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  test("backend:src/api/** does NOT match src/other/foo.ts → violation", () => {
    const diff = makeDiff("src/other/foo.ts");
    const result = checkBoundary(diff, ["backend:src/api/**"], "api");
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].file).toBe("src/other/foo.ts");
  });

  test("bare paths still work", () => {
    const diff = makeDiff("src/api/handler.ts");
    const result = checkBoundary(diff, ["src/api/**"], "api");
    expect(result.pass).toBe(true);
  });

  test("mixed prefixed and bare paths work", () => {
    const diff = makeDiff("src/api/handler.ts", "lib/utils.ts");
    const result = checkBoundary(diff, ["backend:src/api/**", "lib/**"], "api");
    expect(result.pass).toBe(true);
  });

  test("violation message shows original (with-prefix) owns_files", () => {
    const diff = makeDiff("src/other/foo.ts");
    const result = checkBoundary(diff, ["backend:src/api/**"], "api");
    expect(result.pass).toBe(false);
    expect(result.violations[0].message).toContain("backend:src/api/**");
  });

  test("custom infraExclusions merged with defaults", () => {
    const diff = makeDiff("custom-infra.lock");
    const result = checkBoundary(diff, ["src/**"], "api", {
      infraExclusions: ["custom-infra.lock"],
    });
    expect(result.pass).toBe(false);
    expect(result.violations[0].message).toContain("protected infrastructure file");
  });

  test("default infra exclusions still work with custom ones", () => {
    const diff = makeDiff("package.json");
    const result = checkBoundary(diff, ["src/**"], "api", {
      infraExclusions: ["custom.lock"],
    });
    expect(result.pass).toBe(false);
    expect(result.violations[0].message).toContain("protected infrastructure file");
  });

  test("requireBoundary + empty ownsFiles still hard-errors", () => {
    const diff = makeDiff("src/api/handler.ts");
    const result = checkBoundary(diff, [], "api", { requireBoundary: true });
    expect(result.pass).toBe(false);
    expect(result.violations[0].message).toContain("No boundary defined");
  });
});
