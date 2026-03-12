/**
 * workspace-loader.ts — Load and resolve the minds-workspace.json manifest.
 *
 * Search order:
 * 1. MINDS_WORKSPACE env var (explicit path)
 * 2. <repoRoot>/minds-workspace.json
 * 3. <repoRoot>/../minds-workspace.json
 *
 * When no manifest found: returns single-repo fallback.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import {
  WORKSPACE_MANIFEST_FILENAME,
  validateWorkspaceManifestDetailed,
  type WorkspaceManifest,
} from "./workspace.ts";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolvedWorkspace {
  manifest: WorkspaceManifest | null;
  repoPaths: Map<string, string>;   // alias -> absolute path
  orchestratorRoot: string;
  isMultiRepo: boolean;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load and resolve the workspace manifest.
 *
 * @param repoRoot - Absolute path to the current git repo root.
 * @returns A resolved workspace with absolute paths for each repo alias.
 * @throws If manifest exists but is invalid, a repo path doesn't exist, or a repo path is not a git repo.
 */
export function loadWorkspace(repoRoot: string): ResolvedWorkspace {
  const manifestPath = findManifest(repoRoot);

  if (!manifestPath) {
    // Single-repo fallback
    return {
      manifest: null,
      repoPaths: new Map(),
      orchestratorRoot: repoRoot,
      isMultiRepo: false,
    };
  }

  // Read and parse
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Failed to parse ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Validate
  const validation = validateWorkspaceManifestDetailed(raw);
  if (!validation.valid) {
    throw new Error(
      `Invalid workspace manifest at ${manifestPath}:\n  - ${validation.errors.join("\n  - ")}`,
    );
  }

  const manifest = raw as WorkspaceManifest;
  const manifestDir = dirname(manifestPath);

  // Resolve repo paths
  const repoPaths = new Map<string, string>();
  for (const repo of manifest.repos) {
    const resolved = resolve(manifestDir, repo.path);

    if (!existsSync(resolved)) {
      throw new Error(
        `Repo "${repo.alias}" path does not exist: ${resolved}`,
      );
    }

    // Verify it's a git repo (MR-P3 security)
    if (!isGitRepo(resolved)) {
      throw new Error(
        `Repo "${repo.alias}" at ${resolved} is not a git repository`,
      );
    }

    repoPaths.set(repo.alias, resolved);
  }

  const orchestratorRoot = repoPaths.get(manifest.orchestratorRepo)!;

  return {
    manifest,
    repoPaths,
    orchestratorRoot,
    isMultiRepo: manifest.repos.length > 1,
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Find the workspace manifest file. Search order:
 * 1. MINDS_WORKSPACE env var
 * 2. <repoRoot>/minds-workspace.json
 * 3. <repoRoot>/../minds-workspace.json
 */
function findManifest(repoRoot: string): string | null {
  // 1. Env var override
  const envPath = process.env.MINDS_WORKSPACE;
  if (envPath) {
    const resolved = resolve(envPath);
    if (existsSync(resolved)) return resolved;
    throw new Error(
      `MINDS_WORKSPACE env var points to non-existent file: ${resolved}`,
    );
  }

  // 2. In repo root
  const inRoot = resolve(repoRoot, WORKSPACE_MANIFEST_FILENAME);
  if (existsSync(inRoot)) return inRoot;

  // 3. One level up from repo root
  const inParent = resolve(repoRoot, "..", WORKSPACE_MANIFEST_FILENAME);
  if (existsSync(inParent)) return inParent;

  return null;
}

/**
 * Check if a directory is a git repository.
 * Uses Bun.spawnSync for array-based spawning (MR-P3 — no shell injection).
 */
function isGitRepo(dirPath: string): boolean {
  const result = Bun.spawnSync(
    ["git", "-C", dirPath, "rev-parse", "--is-inside-work-tree"],
    { stdout: "pipe", stderr: "pipe" },
  );
  return result.exitCode === 0;
}
