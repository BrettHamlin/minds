/**
 * workspace.ts — Schema and types for the minds-workspace.json manifest.
 *
 * Defines the workspace manifest format for multi-repo support.
 * Single source of truth for workspace validation (MR-001, MR-P3).
 */

import { containsPathTraversal } from "./paths.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

export const WORKSPACE_MANIFEST_FILENAME = "minds-workspace.json";

/** Alias must be alphanumeric, hyphens, or underscores. No colons, slashes, or spaces. */
export const ALIAS_PATTERN = /^[\w-]+$/;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkspaceRepo {
  alias: string;              // Unique alias (e.g., "backend", "frontend")
  path: string;               // Relative to manifest location
  installCommand?: string;    // Default: "bun install"
  testCommand?: string;       // Default: "bun test"
  infraExclusions?: string[]; // Per-repo infrastructure protection
  defaultBranch?: string;     // Default: repo's current branch
}

export interface WorkspaceManifest {
  version: 1;
  orchestratorRepo: string;   // Alias of repo hosting minds/ orchestrator
  repos: WorkspaceRepo[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Runtime validation guard for WorkspaceManifest.
 * Checks structural validity, alias uniqueness, path safety, and referential integrity.
 */
export function validateWorkspaceManifest(value: unknown): value is WorkspaceManifest {
  const result = validateWorkspaceManifestDetailed(value);
  return result.valid;
}

/**
 * Detailed validation returning all errors found.
 * Used by loadWorkspace() for actionable error messages.
 */
export function validateWorkspaceManifestDetailed(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["Manifest must be a JSON object"] };
  }

  const obj = value as Record<string, unknown>;

  // version must be exactly 1
  if (obj.version !== 1) {
    errors.push(`"version" must be 1, got ${JSON.stringify(obj.version)}`);
  }

  // orchestratorRepo must be a string
  if (typeof obj.orchestratorRepo !== "string" || obj.orchestratorRepo.length === 0) {
    errors.push(`"orchestratorRepo" must be a non-empty string`);
  }

  // repos must be a non-empty array
  if (!Array.isArray(obj.repos) || obj.repos.length === 0) {
    errors.push(`"repos" must be a non-empty array`);
    return { valid: false, errors };
  }

  const seenAliases = new Set<string>();
  let orchestratorFound = false;

  for (let i = 0; i < obj.repos.length; i++) {
    const repo = obj.repos[i];
    if (typeof repo !== "object" || repo === null || Array.isArray(repo)) {
      errors.push(`repos[${i}] must be an object`);
      continue;
    }

    const r = repo as Record<string, unknown>;

    // alias validation
    if (typeof r.alias !== "string" || r.alias.length === 0) {
      errors.push(`repos[${i}].alias must be a non-empty string`);
    } else if (!ALIAS_PATTERN.test(r.alias)) {
      errors.push(`repos[${i}].alias "${r.alias}" contains invalid characters — only letters, digits, hyphens, and underscores allowed`);
    } else if (seenAliases.has(r.alias)) {
      errors.push(`Duplicate alias "${r.alias}"`);
    } else {
      seenAliases.add(r.alias);
      if (r.alias === obj.orchestratorRepo) orchestratorFound = true;
    }

    // path validation
    if (typeof r.path !== "string" || r.path.length === 0) {
      errors.push(`repos[${i}].path must be a non-empty string`);
    } else if (containsPathTraversal(r.path as string)) {
      errors.push(`Repo "${r.alias}" path contains ".." — path traversal not allowed`);
    }

    // Optional field validation
    // Note: installCommand and testCommand are validated as strings here.
    // Shell injection prevention is enforced at execution time (Phase 4, MR-012)
    // via array-based spawning — commands are never passed through a shell.
    if (r.installCommand !== undefined && typeof r.installCommand !== "string") {
      errors.push(`repos[${i}].installCommand must be a string`);
    }
    if (r.testCommand !== undefined && typeof r.testCommand !== "string") {
      errors.push(`repos[${i}].testCommand must be a string`);
    }
    if (r.defaultBranch !== undefined && typeof r.defaultBranch !== "string") {
      errors.push(`repos[${i}].defaultBranch must be a string`);
    }
    if (r.infraExclusions !== undefined) {
      if (!Array.isArray(r.infraExclusions) || !r.infraExclusions.every((e) => typeof e === "string")) {
        errors.push(`repos[${i}].infraExclusions must be an array of strings`);
      }
    }
  }

  // orchestratorRepo must reference an existing alias
  if (typeof obj.orchestratorRepo === "string" && obj.orchestratorRepo.length > 0 && !orchestratorFound) {
    errors.push(`"orchestratorRepo" value "${obj.orchestratorRepo}" does not match any repo alias`);
  }

  return { valid: errors.length === 0, errors };
}
