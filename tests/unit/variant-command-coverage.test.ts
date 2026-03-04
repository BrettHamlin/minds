/**
 * tests/unit/variant-command-coverage.test.ts
 *
 * Guard test: ensures every command referenced in a pipeline variant config
 * has a corresponding .md file in src/commands/.
 *
 * Pipeline variant configs live in src/config/pipeline-variants/*.json.
 * Each phase may have a "command" field like "/collab.spec-critique".
 * The installer copies these commands to .claude/commands/ automatically
 * (see src/commands/collab.install.ts — variant command scan block).
 *
 * If a variant config references a command that doesn't exist in src/commands/,
 * the pipeline will fail at runtime when that phase is dispatched. This test
 * catches that class of bug at test time.
 *
 * Failure message format:
 *   Pipeline variant backend.json references /collab.spec-critique
 *   but src/commands/collab.spec-critique.md does not exist
 */

import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const VARIANTS_DIR = join(PROJECT_ROOT, "src/config/pipeline-variants");
const COMMANDS_DIR = join(PROJECT_ROOT, "src/commands");

// ─── Helper ──────────────────────────────────────────────────────────────────

interface Gap {
  variantFile: string;
  command: string;
  expectedFile: string;
}

function collectGaps(): Gap[] {
  const gaps: Gap[] = [];

  if (!existsSync(VARIANTS_DIR)) return gaps;

  const variantFiles = readdirSync(VARIANTS_DIR).filter((f) => f.endsWith(".json"));

  for (const vf of variantFiles) {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(readFileSync(join(VARIANTS_DIR, vf), "utf-8"));
    } catch {
      // Skip malformed JSON — a separate schema test should catch this
      continue;
    }

    const phases = (config.phases ?? {}) as Record<string, Record<string, unknown>>;
    for (const phase of Object.values(phases)) {
      const cmd = phase.command;
      if (typeof cmd !== "string" || !cmd.startsWith("/")) continue;

      const cmdName = cmd.slice(1); // strip leading "/"
      const cmdFile = cmdName.endsWith(".md") ? cmdName : `${cmdName}.md`;
      const srcPath = join(COMMANDS_DIR, cmdFile);

      if (!existsSync(srcPath)) {
        gaps.push({ variantFile: vf, command: cmd, expectedFile: srcPath });
      }
    }
  }

  return gaps;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("variant-command-coverage: every variant command must exist in src/commands/", () => {
  test("all pipeline variant command references resolve to existing src/commands/*.md files", () => {
    const gaps = collectGaps();

    if (gaps.length === 0) {
      // All good — every variant command has a source file
      expect(gaps).toHaveLength(0);
      return;
    }

    // Build a descriptive failure message for each gap
    const messages = gaps.map(
      (g) =>
        `Pipeline variant ${g.variantFile} references ${g.command} ` +
        `but ${g.expectedFile} does not exist`
    );

    // Fail with all gaps listed
    expect(
      messages,
      `Found ${gaps.length} missing command file(s):\n${messages.join("\n")}`
    ).toHaveLength(0);
  });

  test("variant configs directory exists and contains at least one config", () => {
    expect(existsSync(VARIANTS_DIR)).toBe(true);
    const files = readdirSync(VARIANTS_DIR).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
  });
});
