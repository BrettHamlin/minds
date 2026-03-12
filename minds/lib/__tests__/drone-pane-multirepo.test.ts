/**
 * drone-pane-multirepo.test.ts — Tests for multi-repo worktree creation (MR-011).
 *
 * Verifies:
 * - assembleClaudeContent reads minds.json from correct repo root
 * - Worktree name includes repo alias when provided
 * - Without new flags: existing behavior unchanged
 * - STANDARDS loaded from orchestrator root when provided
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assembleClaudeContent } from "../drone-pane.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tempDir(): string {
  const dir = join(tmpdir(), `drone-pane-mr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMindsJson(repoRoot: string, minds: Array<{ name: string; domain?: string; owns_files?: string[] }>): void {
  const mindsDir = join(repoRoot, ".minds");
  mkdirSync(mindsDir, { recursive: true });
  writeFileSync(join(mindsDir, "minds.json"), JSON.stringify(minds, null, 2));
}

function writeStandards(repoRoot: string, content: string): void {
  const mindsDir = join(repoRoot, ".minds");
  mkdirSync(mindsDir, { recursive: true });
  writeFileSync(join(mindsDir, "STANDARDS.md"), content);
}

function writeProjectStandards(repoRoot: string, content: string): void {
  const mindsDir = join(repoRoot, ".minds");
  mkdirSync(mindsDir, { recursive: true });
  writeFileSync(join(mindsDir, "STANDARDS-project.md"), content);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("assembleClaudeContent — multi-repo (MR-011)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = tempDir();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("reads minds.json from the repo root", () => {
    const repoRoot = join(tmpRoot, "backend");
    writeMindsJson(repoRoot, [
      { name: "api", domain: "API layer", owns_files: ["src/api/**"] },
    ]);

    const content = assembleClaudeContent(repoRoot, "api", "BRE-100");
    expect(content).toContain("@api");
    expect(content).toContain("BRE-100");
    expect(content).toContain("API layer");
    expect(content).toContain("src/api/**");
  });

  test("includes Repository Context when repoAlias provided", () => {
    const repoRoot = join(tmpRoot, "backend");
    writeMindsJson(repoRoot, [{ name: "api" }]);

    const content = assembleClaudeContent(repoRoot, "api", "BRE-100", {
      repoAlias: "backend",
    });
    expect(content).toContain("## Repository Context");
    expect(content).toContain("**backend**");
    expect(content).toContain("read-only references");
  });

  test("omits Repository Context when no repoAlias", () => {
    const repoRoot = join(tmpRoot, "solo");
    writeMindsJson(repoRoot, [{ name: "api" }]);

    const content = assembleClaudeContent(repoRoot, "api", "BRE-100");
    expect(content).not.toContain("Repository Context");
  });

  test("loads STANDARDS.md from orchestrator root when provided", () => {
    const repoRoot = join(tmpRoot, "backend");
    const orchestratorRoot = join(tmpRoot, "orchestrator");
    writeMindsJson(repoRoot, [{ name: "api" }]);
    writeStandards(orchestratorRoot, "# Orchestrator Standards\nThese are shared.");

    const content = assembleClaudeContent(repoRoot, "api", "BRE-100", {
      orchestratorRoot,
    });
    expect(content).toContain("Orchestrator Standards");
    expect(content).toContain("These are shared.");
  });

  test("loads STANDARDS-project.md from orchestrator root when provided", () => {
    const repoRoot = join(tmpRoot, "backend");
    const orchestratorRoot = join(tmpRoot, "orchestrator");
    writeMindsJson(repoRoot, [{ name: "api" }]);
    writeProjectStandards(orchestratorRoot, "# Project-Specific Standards");

    const content = assembleClaudeContent(repoRoot, "api", "BRE-100", {
      orchestratorRoot,
    });
    expect(content).toContain("Project-Specific Standards");
  });

  test("loads STANDARDS from repo root when no orchestratorRoot", () => {
    const repoRoot = join(tmpRoot, "solo");
    writeMindsJson(repoRoot, [{ name: "api" }]);
    writeStandards(repoRoot, "# Solo Standards");

    const content = assembleClaudeContent(repoRoot, "api", "BRE-100");
    expect(content).toContain("Solo Standards");
  });

  test("without new flags: existing behavior unchanged", () => {
    const repoRoot = join(tmpRoot, "solo");
    writeMindsJson(repoRoot, [
      { name: "core", domain: "Core", owns_files: ["src/**"] },
    ]);
    writeStandards(repoRoot, "# Standards");

    const content = assembleClaudeContent(repoRoot, "core", "BRE-200");
    expect(content).toContain("@core");
    expect(content).toContain("BRE-200");
    expect(content).toContain("Core");
    expect(content).toContain("src/**");
    expect(content).toContain("# Standards");
    expect(content).not.toContain("Repository Context");
  });
});
