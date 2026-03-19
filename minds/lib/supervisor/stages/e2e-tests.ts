/**
 * e2e-tests.ts — Stage executor that runs E2E tests from a registry file.
 *
 * Reads `tests/e2e/registry.json` (or a custom path via stage.config.registryPath)
 * from the worktree root. Each entry maps a mind label to a test file path. The
 * stage runs each test file via `bun test <file>` (or the configured testCommand)
 * and returns findings for any failures.
 *
 * Gracefully skips when no registry exists — this stage is a no-op for repos
 * that have not yet scaffolded E2E tests.
 *
 * Registry schema:
 *   { "tests": [{ "mind": "@my-mind", "file": "tests/e2e/my.test.ts" }] }
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";
import type { ReviewFinding } from "../supervisor-types.ts";

// ---------------------------------------------------------------------------
// Registry schema
// ---------------------------------------------------------------------------

export interface E2eTestEntry {
  mind: string;
  file: string;
}

export interface E2eRegistry {
  tests: E2eTestEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_REGISTRY_PATH = "tests/e2e/registry.json";

export function readE2eRegistry(worktreePath: string, registryPath: string): E2eRegistry | null {
  const fullPath = join(worktreePath, registryPath);
  if (!existsSync(fullPath)) return null;
  try {
    const content = readFileSync(fullPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as E2eRegistry).tests)) {
      return null;
    }
    return parsed as E2eRegistry;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stage executor
// ---------------------------------------------------------------------------

export const executeE2eTests = async (
  stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { worktreePath, testCommand } = ctx.supervisorConfig;
  const registryPath =
    (stage.config?.registryPath as string | undefined) ?? DEFAULT_REGISTRY_PATH;

  const registry = readE2eRegistry(worktreePath, registryPath);

  // Filter to entries for the current mind only
  const mindLabel = "@" + ctx.supervisorConfig.mindName;
  const mindEntries = registry ? registry.tests.filter((e) => e.mind === mindLabel) : [];

  // Gracefully skip when no registry exists or no entries for this mind
  if (!registry || mindEntries.length === 0) {
    if (ctx.checkResults) {
      ctx.checkResults.e2eTestsPass = true;
    }
    return { ok: true };
  }

  const findings: ReviewFinding[] = [];
  let allPass = true;

  for (const entry of mindEntries) {
    const fullFilePath = join(worktreePath, entry.file);

    // Skip test files that don't exist yet (not yet written by a drone)
    if (!existsSync(fullFilePath)) continue;

    const cmd = testCommand ?? "bun test";
    const proc = Bun.spawnSync(["sh", "-c", `${cmd} ${entry.file}`], {
      cwd: worktreePath,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    });

    if (proc.exitCode !== 0) {
      allPass = false;
      const stdout = new TextDecoder().decode(proc.stdout);
      const stderr = new TextDecoder().decode(proc.stderr);
      const output = (stdout + stderr).trim();
      const excerpt = output.length > 500 ? output.slice(0, 500) + "…" : output;
      findings.push({
        file: entry.file,
        line: 0,
        severity: "error",
        message: `E2E test failed [${entry.mind}]: ${excerpt || `exit code ${proc.exitCode}`}`,
      });
    }
  }

  if (ctx.checkResults) {
    ctx.checkResults.e2eTestsPass = allPass;
  }

  if (!allPass) {
    return { ok: false, findings };
  }

  return { ok: true };
};
