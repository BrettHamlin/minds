/**
 * supervisor-checks.ts — Deterministic verification after drone completion.
 *
 * Contains engineering standards loading and the full deterministic check
 * pipeline: git diff, scoped bun test, boundary check, and contract check.
 */

import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";
import { resolveMindsDir } from "../../shared/paths.ts";
import { checkBoundary } from "./boundary-check.ts";
import { parseAnnotations, verifyContracts } from "../check-contracts-core.ts";
import type { CheckResults, ReviewFinding } from "./supervisor-types.ts";

// ---------------------------------------------------------------------------
// Load Engineering Standards
// ---------------------------------------------------------------------------

export function loadStandards(repoRoot: string): string {
  const mindsDir = resolveMindsDir(repoRoot);
  const standardsPath = join(mindsDir, "STANDARDS.md");
  const projectStandardsPath = join(mindsDir, "STANDARDS-project.md");

  let standards = "";
  if (existsSync(standardsPath)) {
    standards = readFileSync(standardsPath, "utf-8");
  }
  if (existsSync(projectStandardsPath)) {
    const projectContent = readFileSync(projectStandardsPath, "utf-8");
    standards = standards ? standards + "\n\n" + projectContent : projectContent;
  }
  return standards;
}

// ---------------------------------------------------------------------------
// Deterministic Checks (git diff + bun test + boundary + contracts)
//
// Note: runDeterministicChecksDefault spawns git and bun subprocesses,
// making it impractical to unit test in isolation. It is tested via
// integration tests in __tests__/mind-supervisor-integration.test.ts
// where the full supervisor loop is exercised with mocked deps.
// ---------------------------------------------------------------------------

export function runDeterministicChecksDefault(worktreePath: string, baseBranch: string, mindName: string, tasks?: import("../../cli/lib/implement-types.ts").MindTask[]): CheckResults {
  const findings: ReviewFinding[] = [];

  // Get diff relative to base branch
  const diffProc = Bun.spawnSync(
    ["git", "-C", worktreePath, "diff", `${baseBranch}...HEAD`],
    { stdout: "pipe", stderr: "pipe" }
  );
  let diff = new TextDecoder().decode(diffProc.stdout);

  if (diffProc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(diffProc.stderr);
    findings.push({
      file: "(git diff)",
      line: 0,
      severity: "error",
      message: `git diff failed (exit ${diffProc.exitCode}): ${stderr.trim() || "unknown error"}. Review cannot proceed on an empty diff.`,
    });
    diff = "";
  }

  // Run scoped tests
  const mindsRelative = relative(worktreePath, resolveMindsDir(worktreePath));
  const testProc = Bun.spawnSync(
    ["bun", "test", `${mindsRelative}/${mindName}/`],
    { cwd: worktreePath, stdout: "pipe", stderr: "pipe", timeout: 120_000 }
  );
  const testStdout = new TextDecoder().decode(testProc.stdout);
  const testStderr = new TextDecoder().decode(testProc.stderr);
  const testOutput = testStdout + (testStderr ? `\n${testStderr}` : "");
  const testsPass = testProc.exitCode === 0;

  const result: CheckResults = { diff, testOutput, testsPass, findings };

  // -- Boundary check --------------------------------------------------------
  let ownsFiles: string[] = [];
  try {
    const mindsDir = resolveMindsDir(worktreePath);
    const mindsJsonPath = join(mindsDir, "minds.json");

    if (existsSync(mindsJsonPath)) {
      const mindsJsonContent = readFileSync(mindsJsonPath, "utf-8");
      const registry = JSON.parse(mindsJsonContent) as Array<{ name: string; owns_files?: string[] }>;
      const entry = registry.find((m) => m.name === mindName);
      if (entry?.owns_files) {
        ownsFiles = entry.owns_files;
      } else {
        console.log(`[supervisor] @${mindName}: Not found in minds.json — skipping boundary check`);
      }
    } else {
      console.log(`[supervisor] @${mindName}: minds.json not found — skipping boundary check`);
    }
  } catch (err) {
    console.log(`[supervisor] @${mindName}: Failed to read minds.json — skipping boundary check: ${err}`);
  }

  // Pass ownsFiles through so agent generation can use it
  result.ownsFiles = ownsFiles;

  if (diff) {
    const boundaryResult = checkBoundary(diff, ownsFiles, mindName);
    result.boundaryPass = boundaryResult.pass;
    result.boundaryFindings = boundaryResult.violations.map((v) => ({
      file: v.file,
      line: 0,
      severity: "error" as const,
      message: v.message,
    }));
  }

  // -- Contract check --------------------------------------------------------
  if (tasks && tasks.length > 0) {
    // Serialize tasks back to the annotation format the parser expects
    const tasksText = tasks.map((t) => {
      let line = `- [ ] ${t.id} @${t.mind} ${t.description}`;
      if (t.produces) {
        line += ` produces: \`${t.produces.interface}\` at ${t.produces.path}`;
      }
      if (t.consumes) {
        line += ` consumes: \`${t.consumes.interface}\` from ${t.consumes.path}`;
      }
      return line;
    }).join("\n");

    const annotations = parseAnnotations(tasksText, mindName);
    if (annotations.length > 0) {
      const contractResult = verifyContracts(annotations, worktreePath, mindName);
      result.contractsPass = contractResult.pass;
      result.contractFindings = contractResult.violations.map((v) => ({
        file: v.annotation.filePath,
        line: 0,
        severity: "error" as const,
        message: `[${v.annotation.taskId}] ${v.reason}`,
      }));
    }
  }

  return result;
}
