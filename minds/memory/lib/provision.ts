/**
 * provision.ts — Idempotent per-Mind memory directory provisioning.
 *
 * Scans minds/ directory, creates memory/ dir + seeds MEMORY.md for any
 * Mind that doesn't have one yet. Safe to call repeatedly.
 */

import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "fs";
import { memoryDir, memoryMdPath, contractDataDir } from "./paths.js";

/** Result of provisioning a single Mind. */
export interface ProvisionResult {
  mindName: string;
  status: "created" | "already_exists";
  memoryDir: string;
}

/** Result of provisioning all Minds. */
export interface ProvisionAllResult {
  provisioned: ProvisionResult[];
  skipped: string[];
}

const CONTRACT_DATA_README = `# Contract Data Directory

Stores ContractPattern JSON files for cross-Mind handoff patterns.

## Format

Each file is a JSON-serialized ContractPattern with the following fields:

- \`sourcePhase\` — originating Mind/phase name (e.g. "clarify")
- \`targetPhase\` — receiving Mind/phase name (e.g. "plan")
- \`artifactShape\` — human-readable description of the artifact's shape
- \`sections\` — ordered list of expected sections (name, required, description)
- \`metadata\` — key-value tags for categorization
- \`timestamp\` — ISO 8601 recording time

## Naming

Files are named \`{sourcePhase}-{targetPhase}-{timestamp}.json\`.

## Indexing

An FTS5 SQLite index (\`.index.db\`) is maintained alongside these files.
It is rebuilt by \`syncContractIndex()\` and queried via \`searchMemory({ scope: "contracts" })\`.

## Cold Start

This directory starts empty. Patterns accumulate from successful Mind-to-Mind handoffs.
The first search returns no results — drones proceed without context until patterns exist.
`;

/**
 * Provisions the shared contract data directory.
 * Idempotent: skips if directory + README already exist.
 *
 * @returns The path to the provisioned directory.
 */
export async function provisionContractDir(): Promise<string> {
  const dir = contractDataDir();

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const readmePath = join(dir, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, CONTRACT_DATA_README, "utf8");
  }

  return dir;
}

const SEED_MEMORY_MD = `# {MIND_NAME} Mind — Curated Memory

## Architecture Decisions

<!-- Add curated learnings here after review cycles. -->

## Key Conventions

<!-- Add stable conventions and patterns here. -->
`;

/**
 * Provisions memory directory for a single Mind.
 * Idempotent: skips if memory dir + MEMORY.md already exist.
 *
 * @param mindName - Name of the Mind (e.g. "pipeline_core")
 * @returns ProvisionResult with status "created" or "already_exists"
 */
export async function provisionMind(mindName: string): Promise<ProvisionResult> {
  const dir = memoryDir(mindName);
  const mdPath = memoryMdPath(mindName);

  if (existsSync(dir) && existsSync(mdPath)) {
    return { mindName, status: "already_exists", memoryDir: dir };
  }

  mkdirSync(dir, { recursive: true });

  if (!existsSync(mdPath)) {
    const content = SEED_MEMORY_MD.replace("{MIND_NAME}", mindName);
    writeFileSync(mdPath, content, "utf8");
  }

  return { mindName, status: "created", memoryDir: dir };
}

/**
 * Provisions memory directories for all Minds found in the minds/ directory.
 * Dynamically discovers Minds by scanning directory entries.
 * Skips non-Mind entries (no server.ts) and the memory Mind itself (already handled).
 *
 * @param mindsDir - Optional override for the minds/ directory path.
 * @returns ProvisionAllResult listing what was created or skipped.
 */
export async function provisionAllMinds(mindsDir?: string): Promise<ProvisionAllResult> {
  const resolvedMindsDir = mindsDir ?? join(import.meta.dir, "..", "..");

  let entries: string[];
  try {
    entries = readdirSync(resolvedMindsDir);
  } catch (err: any) {
    throw new Error(`provisionAllMinds: cannot read minds directory at "${resolvedMindsDir}": ${err.message}`);
  }

  const results: ProvisionResult[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    const entryPath = join(resolvedMindsDir, entry);

    // Must be a directory
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(entryPath);
    } catch {
      skipped.push(entry);
      continue;
    }
    if (!stat.isDirectory()) {
      skipped.push(entry);
      continue;
    }

    // Must have a server.ts (is a Mind)
    const serverFile = join(entryPath, "server.ts");
    if (!existsSync(serverFile)) {
      skipped.push(entry);
      continue;
    }

    const result = await provisionMind(entry);
    results.push(result);
  }

  return { provisioned: results, skipped };
}
