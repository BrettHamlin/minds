/**
 * assemble-claude-content-pipeline.test.ts — Tests for pipeline-aware CLAUDE.md assembly.
 *
 * BRE-624: Non-code pipelines should omit file boundary section and test instructions.
 * Code pipeline and default (undefined) must keep current behavior exactly.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { assembleClaudeContent } from "../drone-pane.ts";

const TMP_ROOT = join(import.meta.dir, ".tmp-assemble-pipeline");

function setupTmpDir(): string {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(TMP_ROOT, { recursive: true });
  // resolveMindsDir checks for minds/cli/ to detect dev layout
  mkdirSync(join(TMP_ROOT, "minds", "cli"), { recursive: true });
  return TMP_ROOT;
}

function setupMindsJson(root: string, mindName: string): void {
  const mindsDir = join(root, "minds");
  mkdirSync(join(mindsDir, mindName), { recursive: true });
  writeFileSync(
    join(mindsDir, "minds.json"),
    JSON.stringify([
      { name: mindName, domain: "building", owns_files: ["src/**"] },
    ]),
  );
  writeFileSync(join(mindsDir, "STANDARDS.md"), "Standard rules.");
}

describe("assembleClaudeContent — code pipeline (default)", () => {
  beforeEach(() => setupTmpDir());
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  test("includes file boundary section when pipelineTemplate is undefined", () => {
    setupMindsJson(TMP_ROOT, "code_mind");
    const result = assembleClaudeContent(TMP_ROOT, "code_mind", "BRE-624");
    expect(result).toContain("file boundary");
    expect(result).toContain("src/**");
  });

  test("includes test command when pipelineTemplate is undefined", () => {
    setupMindsJson(TMP_ROOT, "code_mind");
    const result = assembleClaudeContent(TMP_ROOT, "code_mind", "BRE-624");
    expect(result).toContain("bun test");
    expect(result).toContain("Test Command");
  });

  test("explicit code pipeline matches default", () => {
    setupMindsJson(TMP_ROOT, "code_mind");
    const defaultResult = assembleClaudeContent(TMP_ROOT, "code_mind", "BRE-624");
    const codeResult = assembleClaudeContent(TMP_ROOT, "code_mind", "BRE-624", {
      pipelineTemplate: "code",
    });
    expect(defaultResult).toBe(codeResult);
  });
});

describe("assembleClaudeContent — build pipeline", () => {
  beforeEach(() => setupTmpDir());
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  test("omits file boundary section", () => {
    setupMindsJson(TMP_ROOT, "build_mind");
    const result = assembleClaudeContent(TMP_ROOT, "build_mind", "BRE-624", {
      pipelineTemplate: "build",
    });
    expect(result).not.toContain("Your file boundary");
    expect(result).not.toContain("only touch files in these paths");
  });

  test("omits test command section", () => {
    setupMindsJson(TMP_ROOT, "build_mind");
    const result = assembleClaudeContent(TMP_ROOT, "build_mind", "BRE-624", {
      pipelineTemplate: "build",
    });
    expect(result).not.toContain("## Test Command");
    expect(result).not.toContain("bun test");
  });

  test("still contains mind identity", () => {
    setupMindsJson(TMP_ROOT, "build_mind");
    const result = assembleClaudeContent(TMP_ROOT, "build_mind", "BRE-624", {
      pipelineTemplate: "build",
    });
    expect(result).toContain("@build_mind");
    expect(result).toContain("BRE-624");
  });

  test("still contains engineering standards", () => {
    setupMindsJson(TMP_ROOT, "build_mind");
    const result = assembleClaudeContent(TMP_ROOT, "build_mind", "BRE-624", {
      pipelineTemplate: "build",
    });
    expect(result).toContain("Engineering Standards");
    expect(result).toContain("Standard rules.");
  });

  test("still contains DRONE-BRIEF.md reference", () => {
    setupMindsJson(TMP_ROOT, "build_mind");
    const result = assembleClaudeContent(TMP_ROOT, "build_mind", "BRE-624", {
      pipelineTemplate: "build",
    });
    expect(result).toContain("DRONE-BRIEF.md");
  });
});

describe("assembleClaudeContent — test pipeline", () => {
  beforeEach(() => setupTmpDir());
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  test("omits file boundary section", () => {
    setupMindsJson(TMP_ROOT, "test_mind");
    const result = assembleClaudeContent(TMP_ROOT, "test_mind", "BRE-624", {
      pipelineTemplate: "test",
    });
    expect(result).not.toContain("Your file boundary");
    expect(result).not.toContain("only touch files in these paths");
  });

  test("omits test command section", () => {
    setupMindsJson(TMP_ROOT, "test_mind");
    const result = assembleClaudeContent(TMP_ROOT, "test_mind", "BRE-624", {
      pipelineTemplate: "test",
    });
    expect(result).not.toContain("## Test Command");
    expect(result).not.toContain("bun test");
  });

  test("still contains mind identity and standards", () => {
    setupMindsJson(TMP_ROOT, "test_mind");
    const result = assembleClaudeContent(TMP_ROOT, "test_mind", "BRE-624", {
      pipelineTemplate: "test",
    });
    expect(result).toContain("@test_mind");
    expect(result).toContain("Engineering Standards");
  });
});
