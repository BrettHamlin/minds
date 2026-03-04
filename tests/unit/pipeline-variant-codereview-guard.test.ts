/**
 * tests/unit/pipeline-variant-codereview-guard.test.ts
 *
 * Guard test: ensures NO pipeline variant config defines codeReview as a
 * standalone agent-dispatched phase (command "/collab.codeReview").
 *
 * Background: collab.codeReview outputs "REVIEW: PASS/FAIL" for the
 * orchestrator's inline a.2 intercept to parse — it does NOT emit pipeline
 * signals. Defining it as a dispatched phase causes the agent to run the
 * review, output the verdict, then stall with no signal, deadlocking the
 * pipeline.
 *
 * Correct pattern: codeReview as a TOP-LEVEL config object that enables the
 * orchestrator's inline handling, NOT an entry in phases[].
 *
 * Checked locations:
 *   - src/config/pipeline-variants/*.json          (source of truth)
 *   - .collab/config/pipeline-variants/*.json      (installed copy)
 *   - tests/e2e/fixtures/{fixture}/pipeline-variants/*.json (test fixtures)
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");

// ─── File Collection ─────────────────────────────────────────────────────────

function collectVariantFiles(): string[] {
  const files: string[] = [];

  // Helper: collect *.json from a directory (non-recursive)
  function scanDir(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".json")) {
        files.push(join(dir, entry));
      }
    }
  }

  // src/config/pipeline-variants/*.json
  scanDir(join(PROJECT_ROOT, "src/config/pipeline-variants"));

  // .collab/config/pipeline-variants/*.json
  scanDir(join(PROJECT_ROOT, ".collab/config/pipeline-variants"));

  // tests/e2e/fixtures/*/pipeline-variants/*.json
  const fixturesDir = join(PROJECT_ROOT, "tests/e2e/fixtures");
  if (existsSync(fixturesDir)) {
    for (const fixture of readdirSync(fixturesDir)) {
      const variantsDir = join(fixturesDir, fixture, "pipeline-variants");
      scanDir(variantsDir);
    }
  }

  // Deduplicate by resolved path (src and .collab copies may share an inode)
  return [...new Set(files)];
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface PipelineVariantConfig {
  phases?: Record<string, PhaseConfig>;
  codeReview?: unknown;
  [key: string]: unknown;
}

interface PhaseConfig {
  command?: string;
  signals?: string[];
  transitions?: Record<string, { to: string }>;
  terminal?: boolean;
  [key: string]: unknown;
}

interface Violation {
  file: string;
  violation: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function checkConfig(filePath: string, config: PipelineVariantConfig): Violation[] {
  const violations: Violation[] = [];
  const relPath = filePath.replace(PROJECT_ROOT + "/", "");
  const phases = config.phases ?? {};

  // 1. No phase must use /collab.codeReview as its command
  for (const [phaseName, phase] of Object.entries(phases)) {
    if (phase.command === "/collab.codeReview") {
      violations.push({
        file: relPath,
        violation:
          `phases["${phaseName}"].command is "/collab.codeReview" — ` +
          `codeReview must not be an agent-dispatched phase. ` +
          `Move it to a top-level "codeReview" config object instead.`,
      });
    }
  }

  // 2. No phase transition must route to a phase named "codeReview"
  for (const [phaseName, phase] of Object.entries(phases)) {
    if (!phase.transitions) continue;
    for (const [signal, transition] of Object.entries(phase.transitions)) {
      if (transition.to === "codeReview") {
        violations.push({
          file: relPath,
          violation:
            `phases["${phaseName}"].transitions["${signal}"].to is "codeReview" — ` +
            `no phase transition may route to a codeReview phase. ` +
            `Route to the appropriate next phase (e.g. "run_tests") instead.`,
        });
      }
    }
  }

  // 3. If top-level codeReview exists, it must be an object (not a phase-like entry)
  if ("codeReview" in config) {
    const cr = config.codeReview;
    if (typeof cr !== "object" || cr === null || Array.isArray(cr)) {
      violations.push({
        file: relPath,
        violation:
          `Top-level "codeReview" must be a plain config object ` +
          `(e.g. { enabled, model, maxAttempts }), got: ${JSON.stringify(cr)}`,
      });
    } else {
      // Must not look like a phase definition (no command/signals fields)
      const crObj = cr as Record<string, unknown>;
      if ("command" in crObj || "signals" in crObj) {
        violations.push({
          file: relPath,
          violation:
            `Top-level "codeReview" must not have "command" or "signals" fields — ` +
            `that makes it look like a phase definition. ` +
            `It should only contain config keys like { enabled, model, maxAttempts }.`,
        });
      }
    }
  }

  return violations;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("pipeline-variant-codereview-guard: codeReview must not be an agent-dispatched phase", () => {
  const variantFiles = collectVariantFiles();

  test("at least one variant config file exists to guard", () => {
    expect(variantFiles.length).toBeGreaterThan(0);
  });

  test("no variant config defines codeReview as an agent-dispatched phase", () => {
    const allViolations: Violation[] = [];

    for (const filePath of variantFiles) {
      if (!existsSync(filePath)) continue;

      let config: PipelineVariantConfig;
      try {
        config = JSON.parse(readFileSync(filePath, "utf-8"));
      } catch {
        // Malformed JSON is caught by a separate schema test
        continue;
      }

      allViolations.push(...checkConfig(filePath, config));
    }

    if (allViolations.length > 0) {
      const messages = allViolations.map((v) => `  [${v.file}] ${v.violation}`);
      throw new Error(
        `Found ${allViolations.length} codeReview dispatch violation(s):\n${messages.join("\n")}\n\n` +
          `Fix: remove any phases[] entry with command "/collab.codeReview" and any transition ` +
          `routing to "codeReview". Add a top-level "codeReview": { enabled, model, maxAttempts } ` +
          `config object to use the orchestrator's inline a.2 intercept instead.`
      );
    }

    expect(allViolations).toHaveLength(0);
  });
});
