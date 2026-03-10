/**
 * scaffold.ts — Core scaffolding logic for the @instantiate Mind.
 *
 * Creates a new Mind directory structure and registers it in minds.json.
 * Works from both dev repo (minds/) and installed repo (.minds/) layouts.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { mindsRoot } from "@minds/shared/paths.js";
import type { MindDescription } from "@minds/mind.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Returns the directory where Mind source files live.
 *
 * Priority:
 *   1. MINDS_SOURCE_DIR env var (explicit override)
 *   2. .minds/ directory discovery (installed repos — same dir as mindsRoot)
 *   3. minds/ relative to git root (dev repos)
 */
export function mindsSourceDir(): string {
  if (process.env.MINDS_SOURCE_DIR) return process.env.MINDS_SOURCE_DIR;

  // Walk up from cwd looking for .minds/ directory
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".minds");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // Dev fallback: minds/ relative to git root
  try {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    return join(root, "minds");
  } catch {
    return join(process.cwd(), "minds");
  }
}

/**
 * Returns the path to minds.json.
 * In dev mode: .minds/minds.json
 * In installed mode: .minds/minds.json
 */
export function mindsJsonPath(): string {
  return join(mindsRoot(), "minds.json");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validate a Mind name: lowercase letters, digits, hyphens only. */
export function validateMindName(name: string): string | null {
  if (!name || typeof name !== "string") return "name is required";
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return "name must be lowercase, start with a letter, and contain only letters, digits, or hyphens";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

export function generateMindMd(name: string, domain: string): string {
  return `# @${name} Mind Profile

## Domain

${domain}

## Conventions

- **Path construction uses utilities** — never inline path construction.

## Key Files

- \`minds/${name}/server.ts\` — Mind server entry point
- \`minds/${name}/lib/\` — Handler implementations

## Anti-Patterns

- Implementing logic outside \`minds/${name}/lib/\` — keep handlers co-located.

## Review Focus

- All intent handlers return \`{ status: "handled" }\` or \`{ status: "escalate" }\`.
- Error messages include context (which intent, which missing field).
`;
}

export function generateServerTs(name: string, domain: string): string {
  return `/**
 * ${name} Mind — ${domain}
 *
 * Leaf Mind: no children.
 */

import { createMind } from "@minds/server-base.js";
import type { WorkUnit, WorkResult } from "@minds/mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  // const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    // TODO: implement intents
    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "${name}",
  domain: "${domain}",
  keywords: ["${name}"],
  owns_files: ["minds/${name}/"],
  capabilities: [],
  exposes: [],
  consumes: [],
  handle,
});
`;
}

// ---------------------------------------------------------------------------
// Core scaffold function
// ---------------------------------------------------------------------------

export interface ScaffoldResult {
  mindDir: string;
  files: string[];
  registered: boolean;
  mindsJson: string;
}

export interface ScaffoldOptions {
  /** Override the minds source directory (for testing) */
  mindsSrcDir?: string;
  /** Override the minds.json path (for testing) */
  mindsJsonOverride?: string;
}

/**
 * Scaffold a new Mind at {mindsSourceDir}/{name}/ and register it in minds.json.
 *
 * Throws if:
 * - name or domain is missing/invalid
 * - the Mind directory already exists
 * - minds.json write fails
 */
export async function scaffoldMind(
  name: string,
  domain: string,
  opts: ScaffoldOptions = {}
): Promise<ScaffoldResult> {
  // Validate inputs
  const nameError = validateMindName(name);
  if (nameError) throw new Error(`scaffoldMind: ${nameError}`);
  if (!domain || typeof domain !== "string" || !domain.trim()) {
    throw new Error("scaffoldMind: domain is required");
  }

  const srcDir = opts.mindsSrcDir ?? mindsSourceDir();
  const jsonPath = opts.mindsJsonOverride ?? mindsJsonPath();
  const mindDir = join(srcDir, name);

  // Guard: don't overwrite existing Mind
  if (existsSync(mindDir)) {
    throw new Error(`scaffoldMind: Mind directory already exists at ${mindDir}`);
  }

  // Create directory structure
  mkdirSync(join(mindDir, "lib"), { recursive: true });

  // Write MIND.md
  const mindMdPath = join(mindDir, "MIND.md");
  writeFileSync(mindMdPath, generateMindMd(name, domain), "utf8");

  // Write server.ts
  const serverTsPath = join(mindDir, "server.ts");
  writeFileSync(serverTsPath, generateServerTs(name, domain), "utf8");

  const files = [mindMdPath, serverTsPath];

  // Register in minds.json
  let entries: MindDescription[] = [];
  if (existsSync(jsonPath)) {
    try {
      const raw = readFileSync(jsonPath, "utf8");
      entries = JSON.parse(raw) as MindDescription[];
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
  }

  // Remove any stale entry with the same name
  entries = entries.filter((e) => e.name !== name);

  const newEntry: MindDescription = {
    name,
    domain,
    keywords: [name],
    owns_files: [`minds/${name}/`],
    capabilities: [],
  };
  entries.push(newEntry);

  // Atomic write
  const tmpPath = `${jsonPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(entries, null, 2) + "\n", "utf8");
  renameSync(tmpPath, jsonPath);

  return { mindDir, files, registered: true, mindsJson: jsonPath };
}
