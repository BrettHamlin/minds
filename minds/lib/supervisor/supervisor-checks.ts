/**
 * supervisor-checks.ts — Deterministic verification after drone completion.
 *
 * Contains engineering standards loading and the full deterministic check
 * pipeline: git diff, scoped bun test, boundary check, and contract check.
 */

import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";
import { resolveMindsDir, matchesOwnership, stripGlob, normalizeMindsPrefix } from "../../shared/paths.ts";
import { stripRepoPrefix } from "../../shared/repo-path.ts";
import { checkBoundary, parseDiffPaths } from "./boundary-check.ts";
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

/**
 * Check whether a directory is covered by a directory-level owns_files entry
 * (as opposed to only being touched via a specific file entry within it).
 *
 * Example: owns_files = ["tests/core/**", "tests/modules/blueprint/api.test.ts"]
 *   isDirFullyOwned("tests/core/lib", ...) → true  (tests/core/** covers the dir)
 *   isDirFullyOwned("tests/modules/blueprint", ...) → false  (only a specific file is owned)
 *
 * This prevents adding "tests/modules/blueprint/" as a test directory when the
 * mind only owns one specific file in it.
 */
export function isDirFullyOwned(dir: string, ownsFiles: string[]): boolean {
  // If no ownership defined, treat everything as owned (no boundary)
  if (ownsFiles.length === 0) return true;

  const normalizedDir = normalizeMindsPrefix(dir).replace(/\/+$/, "") + "/";

  for (const entry of ownsFiles) {
    const normalized = stripGlob(normalizeMindsPrefix(stripRepoPrefix(entry)));
    // Directory/glob entry: "tests/core/**" → stripped to "tests/core/"
    // The directory is fully owned if the owns_files prefix covers the entire dir
    if (normalized.endsWith("/") && normalizedDir.startsWith(normalized)) {
      return true;
    }
    // Bare directory (no trailing slash, no glob, no dots): "tests/core"
    // normalizedDir "tests/core/" starts with "tests/core" — but we need the
    // entry to be a directory prefix, not a specific file
    if (!normalized.includes(".") && !normalized.endsWith("/")) {
      const asDir = normalized + "/";
      if (normalizedDir.startsWith(asDir)) {
        return true;
      }
    }
  }

  return false;
}

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

  // Load full registry for ownership resolution (current mind + all minds)
  let allMindsOwnership: Record<string, string[]> = {};
  let ownsFilesResolved = configOwnsFiles;
  try {
    const mindsJsonPath = join(mindsDir, "minds.json");
    if (existsSync(mindsJsonPath)) {
      const registry = JSON.parse(readFileSync(mindsJsonPath, "utf-8")) as Array<{ name: string; owns_files?: string[] }>;
      // Build ownership map for all minds
      for (const m of registry) {
        if (m.owns_files?.length) {
          allMindsOwnership[m.name] = m.owns_files;
        }
      }
      // Resolve current mind's owns_files if not provided via config
      if (!ownsFilesResolved?.length) {
        const entry = registry.find((m) => m.name === mindName);
        if (entry?.owns_files?.length) {
          ownsFilesResolved = entry.owns_files;
        }
      }
    }
  } catch {
    // Fall through to default
  }

  // Scope tests to directories the drone ACTUALLY MODIFIED in its own commits,
  // not all files in the full branch diff (which includes prior waves' merges).
  //
  // Strategy: use `git log --name-only baseBranch..HEAD` to get files changed
  // by commits on this branch. This is more precise than `git diff` because
  // it only includes files from the drone's own commits, not files that were
  // already different on the base branch.
  let testPaths: string[] = [];
  {
    const droneProc = Bun.spawnSync(
      ["git", "-C", worktreePath, "log", "--name-only", "--pretty=format:", `${baseBranch}..HEAD`],
      { stdout: "pipe", stderr: "pipe" },
    );
    const droneFiles = droneProc.exitCode === 0
      ? [...new Set(new TextDecoder().decode(droneProc.stdout).trim().split("\n").filter(Boolean))]
      : [];

    // Only include files within the drone's boundary. Use specific test files
    // when possible instead of directories — running `bun test dir/` picks up
    // ALL tests in that directory, including ones from other minds.
    const localOwns = (ownsFilesResolved ?? []).map(f => stripRepoPrefix(f));
    const seen = new Set<string>();
    for (const file of droneFiles) {
      if (file.startsWith(".minds/")) continue;
      // Skip files outside boundary (unless no boundary defined)
      if (localOwns.length > 0 && !matchesOwnership(file, localOwns)) continue;

      // If this is a test file, add it directly (not the directory)
      if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) {
        if (!seen.has(file)) { seen.add(file); testPaths.push(file); }
        continue;
      }

      // For source files, add the parent directory ONLY if the entire directory
      // is within owned boundaries (i.e., at least one owns_files entry covers
      // the directory as a prefix, not just a specific file within it).
      // This prevents adding a directory like tests/modules/blueprint/ when the
      // mind only owns tests/modules/blueprint/api.test.ts specifically.
      const dir = file.replace(/\/[^/]+$/, "");
      if (dir && !seen.has(dir + "/") && isDirFullyOwned(dir, localOwns)) {
        seen.add(dir + "/");
        testPaths.push(dir + "/");
      }
    }
  }

  // Fall back to owns_files if diff produced no testable paths.
  // Mirror the primary path's logic: add test files by exact path (not directory)
  // to avoid bun test discovering unowned sibling test files in the same directory.
  if (testPaths.length === 0 && ownsFilesResolved?.length) {
    const seen = new Set<string>();
    for (const raw of ownsFilesResolved) {
      const p = stripRepoPrefix(raw);
      if (p.startsWith(".minds/")) continue;
      if (p.includes("*")) {
        // Glob pattern → use the directory prefix
        const dir = p.replace(/\*+$/, "").replace(/\/+$/, "") + "/";
        if (dir !== "/" && !seen.has(dir)) { seen.add(dir); testPaths.push(dir); }
      } else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p)) {
        // Specific test file → add by exact path (don't expand to directory)
        if (!seen.has(p)) { seen.add(p); testPaths.push(p); }
      } else if (p.includes(".")) {
        // Other specific file (source) → use parent directory
        const dir = p.replace(/\/[^/]+$/, "") + "/";
        if (dir !== "/" && !seen.has(dir)) { seen.add(dir); testPaths.push(dir); }
      } else {
        // Bare directory name
        const dir = p.replace(/\/+$/, "") + "/";
        if (dir !== "/" && !seen.has(dir)) { seen.add(dir); testPaths.push(dir); }
      }
    }
  }

  // Fall back to the Mind's own directory if nothing else
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
      allMindsOwnership: Object.keys(allMindsOwnership).length > 0 ? allMindsOwnership : undefined,
    });
    result.boundaryPass = boundaryResult.pass;
    result.boundaryFindings = boundaryResult.violations.map((v) => ({
      file: v.file,
      line: 0,
      severity: (v.severity === "warning" ? "warning" : "error") as "error" | "warning",
      message: v.message,
    }));

    // Collect delegated tasks: boundary violations where another mind owns the file.
    // The supervisor can create tasks for those minds in a later wave.
    const delegations = boundaryResult.violations.filter(v => v.ownerMind);
    if (delegations.length > 0) {
      result.delegatedFiles = delegations.map(v => ({
        file: v.file,
        ownerMind: v.ownerMind!,
      }));
    }

    // Unowned files that were allowed through (warnings) — track for audit
    const unownedAllowed = boundaryResult.violations.filter(v => v.severity === "warning" && !v.ownerMind);
    if (unownedAllowed.length > 0) {
      result.autoExpandedFiles = unownedAllowed.map(v => v.file);
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
