/**
 * supervisor-checks.ts — Deterministic verification after drone completion.
 *
 * Contains engineering standards loading and the full deterministic check
 * pipeline: git diff, scoped bun test, boundary check, and contract check.
 */

import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";
import { resolveMindsDir } from "../../shared/paths.ts";
import { stripRepoPrefix } from "../../shared/repo-path.ts";
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

export interface DeterministicCheckOptions {
  worktreePath: string;
  baseBranch: string;
  mindName: string;
  tasks?: import("../../cli/lib/implement-types.ts").MindTask[];
  configOwnsFiles?: string[];
  requireBoundary?: boolean;
  testCommand?: string;
  infraExclusions?: string[];
  /** Infrastructure files this mind is allowed to modify (e.g. package.json for dependency additions). */
  infraAllowed?: string[];
  /** Repo alias for cross-repo contract deferral. */
  repo?: string;
}

export function runDeterministicChecksDefault(options: DeterministicCheckOptions): CheckResults {
  const { worktreePath, baseBranch, mindName, tasks, configOwnsFiles, requireBoundary, testCommand, infraExclusions, infraAllowed, repo } = options;
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

  // Run scoped tests — prefer owns_files source dirs, fall back to Mind dir.
  // owns_files patterns like "src/middleware/rate-limit/**" tell us where the
  // actual source (and tests) live. The Mind dir (.minds/{name}/) may have no tests.
  //
  // owns_files come from three sources (priority order):
  //   1. configOwnsFiles — pre-resolved from main repo's minds.json (works in worktrees)
  //   2. worktree's minds.json — fallback if config didn't provide it
  //   3. default: .minds/{mindName}/
  const mindsDir = resolveMindsDir(worktreePath);
  const mindsRelative = relative(worktreePath, mindsDir);

  let ownsFilesResolved = configOwnsFiles;
  if (!ownsFilesResolved?.length) {
    try {
      const mindsJsonPath = join(mindsDir, "minds.json");
      if (existsSync(mindsJsonPath)) {
        const registry = JSON.parse(readFileSync(mindsJsonPath, "utf-8")) as Array<{ name: string; owns_files?: string[] }>;
        const entry = registry.find((m) => m.name === mindName);
        if (entry?.owns_files?.length) {
          ownsFilesResolved = entry.owns_files;
        }
      }
    } catch {
      // Fall through to default
    }
  }

  // Convert owns_files to test filter paths for bun test.
  // owns_files can be globs ("packages/engine/**"), directories, or individual files.
  // bun test expects directory paths or test file paths as filters.
  let testPaths: string[] = [];
  if (ownsFilesResolved?.length) {
    const seen = new Set<string>();
    for (const raw of ownsFilesResolved) {
      const p = stripRepoPrefix(raw);
      if (p.startsWith(".minds/")) continue;

      // Glob pattern (e.g. "packages/engine/**") → strip glob suffix to get directory
      if (p.includes("*")) {
        const dir = p.replace(/\*+$/, "").replace(/\/+$/, "") + "/";
        if (dir !== "/" && !seen.has(dir)) { seen.add(dir); testPaths.push(dir); }
        continue;
      }

      // Individual file → use parent directory (deduplicated)
      // bun test can't filter by individual source files
      if (p.includes(".")) {
        const dir = p.replace(/\/[^/]+$/, "") + "/";
        if (dir !== "/" && !seen.has(dir)) { seen.add(dir); testPaths.push(dir); }
        continue;
      }

      // Directory path → add trailing slash
      const dir = p.replace(/\/+$/, "") + "/";
      if (dir !== "/" && !seen.has(dir)) { seen.add(dir); testPaths.push(dir); }
    }
  }

  // Fall back to the Mind's own directory if no source owns_files found
  if (testPaths.length === 0) {
    testPaths = [`${mindsRelative}/${mindName}/`];
  }

  const baseCmd = testCommand ?? "bun test";
  const testProc = testCommand
    ? Bun.spawnSync(
        ["sh", "-c", `${baseCmd} ${testPaths.join(" ")}`],
        { cwd: worktreePath, stdout: "pipe", stderr: "pipe", timeout: 120_000 },
      )
    : Bun.spawnSync(
        ["bun", "test", ...testPaths],
        { cwd: worktreePath, stdout: "pipe", stderr: "pipe", timeout: 120_000 },
      );
  const testStdout = new TextDecoder().decode(testProc.stdout);
  const testStderr = new TextDecoder().decode(testProc.stderr);
  const testOutput = testStdout + (testStderr ? `\n${testStderr}` : "");
  const testsPass = testProc.exitCode === 0;

  const result: CheckResults = { diff, testOutput, testsPass, findings };

  // -- Boundary check --------------------------------------------------------
  // Reuse ownsFilesResolved from test scoping (already resolved from config or worktree)
  const ownsFiles = ownsFilesResolved ?? [];
  if (!ownsFiles.length) {
    console.log(`[supervisor] @${mindName}: No owns_files found — skipping boundary check`);
  }

  // Pass ownsFiles through so agent generation can use it
  result.ownsFiles = ownsFiles;

  // Extract file paths mentioned in task descriptions — these are pre-approved by task decomposition
  const taskFiles: string[] = [];
  if (tasks) {
    const pathRe = /(?:^|\s)((?:[\w@.-]+\/)+[\w.-]+\.[\w]+)/g;
    for (const t of tasks) {
      let match: RegExpExecArray | null;
      while ((match = pathRe.exec(t.description)) !== null) {
        taskFiles.push(match[1]);
      }
      pathRe.lastIndex = 0;
    }
  }

  if (diff) {
    const boundaryResult = checkBoundary(diff, ownsFiles, mindName, {
      requireBoundary,
      infraExclusions,
      infraAllowed,
      taskFiles: taskFiles.length > 0 ? taskFiles : undefined,
    });
    result.boundaryPass = boundaryResult.pass;
    result.boundaryFindings = boundaryResult.violations.map((v) => ({
      file: v.file,
      line: 0,
      severity: (v.severity === "warning" ? "warning" : "error") as "error" | "warning",
      message: v.message,
    }));

    // Auto-expand: test files that triggered warnings get added to taskFiles
    // so the NEXT iteration allows them through the boundary check.
    const testWarnings = boundaryResult.violations.filter(v => v.severity === "warning");
    if (testWarnings.length > 0) {
      result.autoExpandedFiles = testWarnings.map(v => v.file);
    }
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
      const contractResult = verifyContracts(annotations, worktreePath, mindName, ownsFiles, repo);
      result.contractsPass = contractResult.pass;
      result.contractFindings = contractResult.violations.map((v) => ({
        file: v.annotation.filePath,
        line: 0,
        severity: "error" as const,
        message: `[${v.annotation.taskId}] ${v.reason}`,
      }));
      if (contractResult.deferredCrossRepo.length > 0) {
        result.deferredCrossRepoAnnotations = contractResult.deferredCrossRepo;
      }
    }
  }

  return result;
}
