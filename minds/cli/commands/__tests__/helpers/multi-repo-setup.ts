/**
 * multi-repo-setup.ts -- Reusable test fixture for multi-repo workspace scenarios.
 *
 * Creates temporary git repos with initial commits, minds.json, workspace manifest,
 * and optional tasks.md. Used across integration tests (MR-023).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { MindDescription } from "../../../../mind.ts";
import {
  WORKSPACE_MANIFEST_FILENAME,
  validateWorkspaceManifest,
  type WorkspaceManifest,
  type WorkspaceRepo,
} from "../../../../shared/workspace.ts";
import { loadWorkspace } from "../../../../shared/workspace-loader.ts";
import { resolveMindsDir } from "../../../../shared/paths.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export interface MultiRepoFixture {
  workspaceRoot: string;
  frontendRoot: string;   // Orchestrator repo
  backendRoot: string;    // Secondary repo
  workspaceManifestPath: string;
  /** For N > 2 repos, access all repos by alias. Always includes "frontend" and "backend". */
  repos: Map<string, string>;
  cleanup: () => void;
}

export interface MultiRepoFixtureOptions {
  frontendMinds?: MindDescription[];
  backendMinds?: MindDescription[];
  tasksContent?: string;
  ticketId?: string;
  /** Number of repos to create. Default 2 (frontend + backend). Extra repos are named "repo-3", "repo-4", etc. */
  repoCount?: number;
  /** Extra repo minds, keyed by alias (for repos beyond frontend/backend). */
  extraRepoMinds?: Record<string, MindDescription[]>;
  /** Per-repo workspace config overrides (installCommand, testCommand, etc.) */
  repoOverrides?: Record<string, Partial<WorkspaceRepo>>;
}

// ── Fixture factory ────────────────────────────────────────────────────────

/**
 * Create a multi-repo workspace fixture with temp git repos.
 *
 * Each repo gets:
 * - git init + initial commit
 * - .minds/minds.json (unless no minds specified)
 *
 * The workspace root gets:
 * - minds-workspace.json with orchestratorRepo = "frontend"
 * - Optionally a specs/<ticketId>/tasks.md file in the frontend repo
 */
export function createMultiRepoFixture(options?: MultiRepoFixtureOptions): MultiRepoFixture {
  const opts = options ?? {};
  const repoCount = Math.max(2, opts.repoCount ?? 2);
  const ticketId = opts.ticketId ?? "BRE-TEST-100";

  // Create workspace root
  const workspaceRoot = join(
    tmpdir(),
    `mr-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(workspaceRoot, { recursive: true });

  // Build repo list: frontend (orchestrator), backend, then extras
  const repoAliases = ["frontend", "backend"];
  for (let i = 3; i <= repoCount; i++) {
    repoAliases.push(`repo-${i}`);
  }

  const repos = new Map<string, string>();
  for (const alias of repoAliases) {
    const repoDir = join(workspaceRoot, alias);
    initGitRepo(repoDir);
    repos.set(alias, repoDir);
  }

  // Write minds.json for each repo
  const mindsByAlias: Record<string, MindDescription[] | undefined> = {
    frontend: opts.frontendMinds,
    backend: opts.backendMinds,
  };
  if (opts.extraRepoMinds) {
    for (const [alias, minds] of Object.entries(opts.extraRepoMinds)) {
      mindsByAlias[alias] = minds;
    }
  }

  for (const [alias, minds] of Object.entries(mindsByAlias)) {
    if (!minds || minds.length === 0) continue;
    const repoDir = repos.get(alias);
    if (!repoDir) continue;
    writeMindsJson(repoDir, minds);
  }

  // Write workspace manifest
  const workspaceRepos: WorkspaceRepo[] = repoAliases.map((alias) => {
    const base: WorkspaceRepo = { alias, path: `./${alias}` };
    const overrides = opts.repoOverrides?.[alias];
    if (overrides) {
      if (overrides.installCommand) base.installCommand = overrides.installCommand;
      if (overrides.testCommand) base.testCommand = overrides.testCommand;
      if (overrides.defaultBranch) base.defaultBranch = overrides.defaultBranch;
      if (overrides.infraExclusions) base.infraExclusions = overrides.infraExclusions;
    }
    return base;
  });

  const manifest: WorkspaceManifest = {
    version: 1,
    orchestratorRepo: "frontend",
    repos: workspaceRepos,
  };

  const manifestPath = join(workspaceRoot, WORKSPACE_MANIFEST_FILENAME);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Write tasks.md if provided (goes into orchestrator repo's specs dir)
  if (opts.tasksContent) {
    const specsDir = join(repos.get("frontend")!, "specs", ticketId);
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "tasks.md"), opts.tasksContent);
  }

  return {
    workspaceRoot,
    frontendRoot: repos.get("frontend")!,
    backendRoot: repos.get("backend")!,
    workspaceManifestPath: manifestPath,
    repos,
    cleanup: () => rmSync(workspaceRoot, { recursive: true, force: true }),
  };
}

// ── Exported helpers ──────────────────────────────────────────────────────

/**
 * Create a temp directory with a unique name.
 * Equivalent to makeTestTmpDir in supervisor helpers.
 */
export function tempDir(prefix: string = "mr-test"): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Initialize a git repo with an initial commit.
 * Sets user.email and user.name for commit to succeed in CI.
 */
export function initGitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  Bun.spawnSync(["git", "init", dir], { stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "-C", dir, "config", "user.email", "test@fixture.com"], {
    stdout: "pipe", stderr: "pipe",
  });
  Bun.spawnSync(["git", "-C", dir, "config", "user.name", "Fixture"], {
    stdout: "pipe", stderr: "pipe",
  });
  Bun.spawnSync(["git", "-C", dir, "commit", "--allow-empty", "-m", "init"], {
    stdout: "pipe", stderr: "pipe",
  });
}

/**
 * Save and clear MINDS_WORKSPACE env var, returning a restore function.
 * Use in beforeEach/afterEach to prevent cross-test contamination.
 */
export function saveAndClearWorkspaceEnv(): () => void {
  const saved = process.env.MINDS_WORKSPACE;
  delete process.env.MINDS_WORKSPACE;
  return () => {
    if (saved !== undefined) process.env.MINDS_WORKSPACE = saved;
    else delete process.env.MINDS_WORKSPACE;
  };
}

/**
 * Write a minds.json file into the repo's .minds/ directory.
 * Uses resolveMindsDir so temp repos get .minds/ (no minds/cli/ present).
 */
export function writeMindsJson(repoRoot: string, minds: MindDescription[]): void {
  const mindsDir = resolveMindsDir(repoRoot);
  mkdirSync(mindsDir, { recursive: true });
  writeFileSync(join(mindsDir, "minds.json"), JSON.stringify(minds, null, 2));
}

// ── Self-test validation ───────────────────────────────────────────────────

/**
 * Validate that a fixture was created correctly.
 * Useful as a quick sanity check in test setup.
 * Returns errors array (empty = valid).
 */
export function validateFixture(fixture: MultiRepoFixture): string[] {
  const errors: string[] = [];

  // Check manifest validates
  try {
    const raw = JSON.parse(readFileSync(fixture.workspaceManifestPath, "utf-8"));
    if (!validateWorkspaceManifest(raw)) {
      errors.push("Workspace manifest failed validation");
    }
  } catch (e) {
    errors.push(`Failed to read manifest: ${e}`);
  }

  // Check all repos have valid git history
  for (const [alias, repoPath] of fixture.repos) {
    const result = Bun.spawnSync(
      ["git", "-C", repoPath, "rev-parse", "HEAD"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) {
      errors.push(`Repo "${alias}" at ${repoPath} has no git history`);
    }
  }

  // Check loadWorkspace resolves correctly
  try {
    const ws = loadWorkspace(fixture.frontendRoot);
    if (!ws.isMultiRepo) {
      errors.push("loadWorkspace returned isMultiRepo=false");
    }
    if (ws.repoPaths.size !== fixture.repos.size) {
      errors.push(
        `loadWorkspace resolved ${ws.repoPaths.size} repos, expected ${fixture.repos.size}`,
      );
    }
  } catch (e) {
    errors.push(`loadWorkspace failed: ${e}`);
  }

  return errors;
}
