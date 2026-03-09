/**
 * Collab CLI — pipeline-lock.json management
 * Provides reproducible installs by locking resolved versions + checksums.
 * All functions are pure (operate on data structures; callers write to disk).
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { makeError } from "../types/index.js";
import type {
  Lockfile,
  LockfilePipeline,
  LockfilePack,
  PipelineManifest,
} from "../types/index.js";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * One entry returned by diffAgainstRegistry describing an available update.
 */
export interface UpdateDiff {
  name: string;
  currentVersion: string;
  latestVersion: string;
  type: "pipeline" | "pack";
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

/**
 * Read pipeline-lock.json. Returns null if not found.
 * Throws CollabError if file exists but is corrupt.
 */
export function readLockfile(lockPath: string): Lockfile | null {
  if (!existsSync(lockPath)) return null;

  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch (err) {
    throw makeError("STATE_CORRUPT", `Cannot read lockfile: ${lockPath}`, {
      path: lockPath,
      cause: String(err),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw makeError("STATE_CORRUPT", `Lockfile is not valid JSON: ${lockPath}`, {
      path: lockPath,
      cause: String(err),
    });
  }

  return validateLockfile(parsed, lockPath);
}

/**
 * Write pipeline-lock.json atomically (write to .tmp, then rename).
 * Creates parent directories as needed.
 */
export function writeLockfile(lockPath: string, lockfile: Lockfile): void {
  const dir = dirname(lockPath);
  mkdirSync(dir, { recursive: true });

  const json = JSON.stringify(lockfile, null, 2) + "\n";
  const tmpPath = lockPath + ".tmp";

  try {
    writeFileSync(tmpPath, json, "utf8");
    renameSync(tmpPath, lockPath);
  } catch (err) {
    throw makeError("ATOMIC_WRITE_FAILED", `Cannot write lockfile: ${lockPath}`, {
      path: lockPath,
      tmpPath,
      cause: String(err),
    });
  }
}

// ─── Generate ─────────────────────────────────────────────────────────────────

/**
 * Generate a new lockfile from resolved manifests.
 * @param resolved  Map of name → manifest (from resolver)
 * @param checksums Map of name → SHA-256 checksum
 * @param tarballUrls Map of name → tarball URL
 */
export function generateLockfile(
  resolved: Map<string, PipelineManifest>,
  checksums: Map<string, string>,
  tarballUrls: Map<string, string>
): Lockfile {
  const pipelines: Record<string, LockfilePipeline> = {};

  for (const [name, manifest] of resolved) {
    pipelines[name] = {
      name,
      resolvedVersion: manifest.version,
      tarballUrl: tarballUrls.get(name) ?? "",
      checksum: checksums.get(name) ?? "",
      dependencies: (manifest.dependencies ?? []).map((d) => d.name),
    };
  }

  return {
    lockfileVersion: 1,
    generatedAt: new Date().toISOString(),
    pipelines,
  };
}

// ─── Mutation helpers (pure — return new lockfile, never mutate) ──────────────

/**
 * Add or update a pipeline entry in the lockfile. Returns updated lockfile (does not write).
 */
export function addPipelineToLockfile(
  lockfile: Lockfile,
  entry: LockfilePipeline
): Lockfile {
  return {
    ...lockfile,
    generatedAt: new Date().toISOString(),
    pipelines: {
      ...lockfile.pipelines,
      [entry.name]: entry,
    },
  };
}

/**
 * Add or update a pack entry in the lockfile.
 * Records the pack version and the exact component pipeline versions resolved at install time.
 * Returns updated lockfile (does not write).
 *
 * @param name     Pack name
 * @param version  Pack version string
 * @param resolved Map of component pipeline name → pinned version
 */
export function addPackToLockfile(
  lockfile: Lockfile,
  name: string,
  version: string,
  resolved: Record<string, string>
): Lockfile {
  const pack: LockfilePack = { version, resolved };
  return {
    ...lockfile,
    generatedAt: new Date().toISOString(),
    packs: {
      ...(lockfile.packs ?? {}),
      [name]: pack,
    },
  };
}

/**
 * Remove a pipeline entry from the lockfile. Returns updated lockfile (does not write).
 * Alias kept for backward compatibility — prefer removeFromLockfile.
 */
export function removePipelineFromLockfile(lockfile: Lockfile, name: string): Lockfile {
  const pipelines = { ...lockfile.pipelines };
  delete pipelines[name];
  return { ...lockfile, generatedAt: new Date().toISOString(), pipelines };
}

/**
 * Remove a pipeline or pack entry from the lockfile by name.
 * Checks packs first, then pipelines. Returns updated lockfile (does not write).
 * Removing a pack does NOT remove the component pipelines (they become direct installs).
 */
export function removeFromLockfile(lockfile: Lockfile, name: string): Lockfile {
  // Check packs first
  if (lockfile.packs && name in lockfile.packs) {
    const packs = { ...lockfile.packs };
    delete packs[name];
    return { ...lockfile, generatedAt: new Date().toISOString(), packs };
  }
  // Otherwise remove from pipelines
  return removePipelineFromLockfile(lockfile, name);
}

// ─── Diff ─────────────────────────────────────────────────────────────────────

/**
 * Compare a lockfile against registry versions to identify available updates.
 * Returns structured UpdateDiff entries for every pipeline or pack that has a newer
 * version available in the registry.
 *
 * @param lockfile        Current lockfile
 * @param registryVersions Map of name → latest version from registry (use buildVersionMap)
 */
export function diffAgainstRegistry(
  lockfile: Lockfile,
  registryVersions: Map<string, string>
): UpdateDiff[] {
  const diffs: UpdateDiff[] = [];

  // Check pipeline entries
  for (const [name, entry] of Object.entries(lockfile.pipelines)) {
    const latestVersion = registryVersions.get(name);
    if (latestVersion && latestVersion !== entry.resolvedVersion) {
      diffs.push({
        name,
        currentVersion: entry.resolvedVersion,
        latestVersion,
        type: "pipeline",
      });
    }
  }

  // Check pack entries
  for (const [name, entry] of Object.entries(lockfile.packs ?? {})) {
    const latestVersion = registryVersions.get(name);
    if (latestVersion && latestVersion !== entry.version) {
      diffs.push({
        name,
        currentVersion: entry.version,
        latestVersion,
        type: "pack",
      });
    }
  }

  return diffs;
}

// ─── Internal ────────────────────────────────────────────────────────────────

function validateLockfile(parsed: unknown, path: string): Lockfile {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw makeError("STATE_CORRUPT", `Lockfile must be a JSON object: ${path}`, { path });
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.lockfileVersion !== 1) {
    throw makeError(
      "STATE_CORRUPT",
      `Unknown lockfile version "${obj.lockfileVersion}": ${path}`,
      { path, lockfileVersion: obj.lockfileVersion }
    );
  }

  const lockfile: Lockfile = {
    lockfileVersion: 1,
    generatedAt: String(obj.generatedAt ?? ""),
    pipelines: (obj.pipelines as Record<string, LockfilePipeline>) ?? {},
  };

  if (typeof obj.registryUrl === "string") {
    lockfile.registryUrl = obj.registryUrl;
  }
  if (obj.packs && typeof obj.packs === "object" && !Array.isArray(obj.packs)) {
    lockfile.packs = obj.packs as Record<string, LockfilePack>;
  }

  return lockfile;
}
