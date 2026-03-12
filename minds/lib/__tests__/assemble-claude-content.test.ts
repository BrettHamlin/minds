/**
 * assemble-claude-content.test.ts — Tests for assembleClaudeContent()
 * extracted from drone-pane.ts (MR-P1).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { assembleClaudeContent } from "../drone-pane.ts";

const TMP_ROOT = join(import.meta.dir, ".tmp-assemble-claude-content");

function setupTmpDir(): string {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
  // resolveMindsDir checks for minds/cli/ to detect dev layout.
  // Create it so the function resolves to minds/ (not .minds/).
  mkdirSync(join(TMP_ROOT, "minds", "cli"), { recursive: true });
  return TMP_ROOT;
}

describe("assembleClaudeContent", () => {
  beforeEach(() => setupTmpDir());
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  test("produces correct output with all files present", () => {
    const root = TMP_ROOT;
    const mindsDir = join(root, "minds");
    mkdirSync(join(mindsDir, "test_mind"), { recursive: true });

    // minds.json with entry for test_mind
    writeFileSync(
      join(mindsDir, "minds.json"),
      JSON.stringify([
        {
          name: "test_mind",
          domain: "testing",
          owns_files: ["src/test/**", "lib/test/**"],
        },
      ]),
    );

    writeFileSync(join(mindsDir, "STANDARDS.md"), "Standard rules here.");
    writeFileSync(join(mindsDir, "STANDARDS-project.md"), "Project-specific rules.");
    writeFileSync(join(mindsDir, "test_mind", "MIND.md"), "I am the test mind.");

    const result = assembleClaudeContent(root, "test_mind", "BRE-100");

    expect(result).toContain("You are the @test_mind drone for ticket BRE-100.");
    expect(result).toContain("Domain: testing");
    expect(result).toContain("- src/test/**");
    expect(result).toContain("- lib/test/**");
    expect(result).toContain("Standard rules here.");
    expect(result).toContain("## Project-Specific Standards");
    expect(result).toContain("Project-specific rules.");
    expect(result).toContain("## Mind Profile (@test_mind)");
    expect(result).toContain("I am the test mind.");
    expect(result).toContain("bun test minds/test_mind/");
    expect(result).toContain("DRONE-BRIEF.md");
  });

  test("handles missing optional files gracefully", () => {
    const root = TMP_ROOT;
    const mindsDir = join(root, "minds");
    mkdirSync(mindsDir, { recursive: true });

    // No minds.json, no STANDARDS, no MIND.md
    const result = assembleClaudeContent(root, "unknown_mind", "BRE-200");

    expect(result).toContain("You are the @unknown_mind drone for ticket BRE-200.");
    expect(result).toContain("(no file boundaries defined)");
    // Should NOT contain domain line or mind profile
    expect(result).not.toContain("Domain:");
    expect(result).not.toContain("## Mind Profile");
    // Should NOT contain project standards section header
    expect(result).not.toContain("## Project-Specific Standards");
  });

  test("handles minds.json with no matching mind", () => {
    const root = TMP_ROOT;
    const mindsDir = join(root, "minds");
    mkdirSync(mindsDir, { recursive: true });

    writeFileSync(
      join(mindsDir, "minds.json"),
      JSON.stringify([{ name: "other_mind", domain: "other", owns_files: ["src/**"] }]),
    );

    const result = assembleClaudeContent(root, "missing_mind", "BRE-300");

    expect(result).toContain("(no file boundaries defined)");
    expect(result).not.toContain("Domain:");
  });

  test("handles malformed minds.json gracefully", () => {
    const root = TMP_ROOT;
    const mindsDir = join(root, "minds");
    mkdirSync(mindsDir, { recursive: true });

    writeFileSync(join(mindsDir, "minds.json"), "{ invalid json");

    const result = assembleClaudeContent(root, "test_mind", "BRE-400");

    // Should not throw — continues with empty values
    expect(result).toContain("You are the @test_mind drone for ticket BRE-400.");
    expect(result).toContain("(no file boundaries defined)");
  });

  test("collapses triple+ newlines to double newlines", () => {
    const root = TMP_ROOT;
    const mindsDir = join(root, "minds");
    mkdirSync(mindsDir, { recursive: true });

    const result = assembleClaudeContent(root, "test_mind", "BRE-500");

    // No triple newlines should appear
    expect(result).not.toMatch(/\n{3,}/);
  });

  test("handles STANDARDS.md present but no project standards", () => {
    const root = TMP_ROOT;
    const mindsDir = join(root, "minds");
    mkdirSync(mindsDir, { recursive: true });

    writeFileSync(join(mindsDir, "STANDARDS.md"), "Generic standards content.");

    const result = assembleClaudeContent(root, "test_mind", "BRE-600");

    expect(result).toContain("Generic standards content.");
    expect(result).not.toContain("## Project-Specific Standards");
  });

  test("mind with empty domain produces no Domain line", () => {
    const root = TMP_ROOT;
    const mindsDir = join(root, "minds");
    mkdirSync(mindsDir, { recursive: true });

    writeFileSync(
      join(mindsDir, "minds.json"),
      JSON.stringify([{ name: "no_domain", domain: "", owns_files: [] }]),
    );

    const result = assembleClaudeContent(root, "no_domain", "BRE-700");

    expect(result).not.toContain("Domain:");
  });
});
