/**
 * collab pipelines install <name> — install a pack or pipeline + all deps
 * Composes: registry → resolver → cli-resolver → integrity → lockfile → state
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync, renameSync, existsSync, cpSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fetchRegistry, fetchManifest, findEntry } from "../../lib/registry.js";
import { resolve, collectCliDeps } from "../../lib/resolver.js";
import { checkAllClis, getBlockingClis, formatCliResult } from "../../lib/cli-resolver.js";
import { verifyChecksum, computeChecksum, verifyDirectoryChecksum } from "../../lib/integrity.js";
import { readState, writeState, addPipeline, isPipelineInstalled } from "../../lib/state.js";
import {
  readLockfile,
  writeLockfile,
  generateLockfile,
  addPipelineToLockfile,
} from "../../lib/lockfile.js";
import { printError } from "../../types/index.js";
import type {
  PipelineManifest,
  RegistryEntry,
  InstalledState,
} from "../../types/index.js";

export interface InstallOptions {
  registryUrl?: string;
  statePath?: string;
  lockPath?: string;
  installDir?: string;
  commandsDir?: string;
  force?: boolean;
}

const DEFAULT_INSTALL_DIR = ".collab/pipelines";
const DEFAULT_STATE_PATH = ".collab/state/installed-pipelines.json";
const DEFAULT_LOCK_PATH = "pipeline-lock.json";
const DEFAULT_COMMANDS_DIR = ".claude/commands";

export async function install(names: string[], options: InstallOptions = {}): Promise<void> {
  if (names.length === 0) {
    console.error("Usage: collab pipelines install <name> [<name>...]");
    process.exit(1);
  }

  const statePath = options.statePath ?? DEFAULT_STATE_PATH;
  const lockPath = options.lockPath ?? DEFAULT_LOCK_PATH;
  const installDir = options.installDir ?? DEFAULT_INSTALL_DIR;
  const commandsDir = options.commandsDir ?? DEFAULT_COMMANDS_DIR;

  console.log(`Fetching registry...`);
  let registry;
  try {
    registry = await fetchRegistry(options.registryUrl);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  // Pre-fetch all transitive dependency manifests before resolving.
  // Iterates until no new deps are discovered — handles arbitrarily deep trees.
  // (A single-pass fetch would cause resolve() to throw MISSING_DEPENDENCY for
  // any transitive dep whose manifest wasn't fetched ahead of time.)
  const manifests = new Map<string, PipelineManifest>();
  const entries = new Map<string, RegistryEntry>();

  console.log(`Resolving dependencies...`);
  const toFetch = new Set<string>(names);
  while (toFetch.size > 0) {
    const batch = [...toFetch];
    toFetch.clear();
    for (const name of batch) {
      if (manifests.has(name)) continue;
      let entry: RegistryEntry;
      try {
        entry = findEntry(registry, name);
      } catch (err) {
        printError(err);
        process.exit(1);
      }
      let manifest: PipelineManifest;
      try {
        manifest = await fetchManifest(entry.manifestUrl);
      } catch (err) {
        printError(err);
        process.exit(1);
      }
      manifests.set(name, manifest);
      entries.set(name, entry);
      for (const dep of manifest.dependencies ?? []) {
        if (!manifests.has(dep.name)) {
          toFetch.add(dep.name);
        }
      }
    }
  }

  // Load current state to determine what's already installed
  let state: InstalledState;
  try {
    state = readState(statePath);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  const installed = new Set(Object.keys(state.pipelines));

  // Resolve full dependency tree — all transitive manifests are pre-fetched above
  let resolveResult;
  try {
    resolveResult = resolve(names, manifests, installed);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  const { order, resolved } = resolveResult;

  // Check CLI dependencies
  const cliDeps = collectCliDeps(resolved);
  if (cliDeps.length > 0) {
    console.log("\nChecking CLI dependencies...");
    const cliResults = checkAllClis(cliDeps);
    for (const result of cliResults) {
      console.log(formatCliResult(result));
    }

    const blocking = getBlockingClis(cliResults);
    if (blocking.length > 0) {
      console.error("\n✗ Required CLI tools are missing or outdated. Cannot install.");
      process.exit(1);
    }
  }

  // Install each pipeline in dependency order
  const checksums = new Map<string, string>();
  const tarballUrls = new Map<string, string>();

  console.log(`\nInstalling ${order.length} pipeline(s)...`);

  for (const name of order) {
    if (!options.force && isPipelineInstalled(state, name)) {
      console.log(`  ✓ ${name} already installed, skipping`);
      continue;
    }

    const entry = entries.get(name);
    const manifest = manifests.get(name);

    if (!entry || !manifest) {
      console.error(`  ✗ ${name}: missing registry entry or manifest`);
      process.exit(1);
    }

    // Download tarball
    console.log(`  ↓ ${name}@${manifest.version}`);
    let tarballData: Buffer;
    try {
      const resp = await fetch(entry.tarballUrl);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      tarballData = Buffer.from(await resp.arrayBuffer());
    } catch (err) {
      console.error(`  ✗ ${name}: download failed — ${err}`);
      process.exit(1);
    }

    // Verify checksum if manifest specifies one
    if (manifest.checksum) {
      try {
        verifyChecksum(tarballData, manifest.checksum, name);
      } catch (err) {
        printError(err);
        process.exit(1);
      }
    }

    const checksum = computeChecksum(tarballData);
    checksums.set(name, checksum);
    tarballUrls.set(name, entry.tarballUrl);

    // Write tarball to install dir (atomic), then extract commands
    const pipelineDir = join(installDir, name);
    mkdirSync(pipelineDir, { recursive: true });
    const tarPath = join(pipelineDir, `${name}-${manifest.version}.tar.gz`);
    const tmpPath = tarPath + ".tmp";
    writeFileSync(tmpPath, tarballData);
    renameSync(tmpPath, tarPath);

    // Extract tarball into pipeline dir (strip top-level dir from archive)
    try {
      execSync(`tar -xzf "${tarPath}" -C "${pipelineDir}" --strip-components=1`, {
        stdio: "pipe",
      });
    } catch (err) {
      console.warn(`  ! ${name}: extraction warning — ${err}`);
    }

    // Verify directory checksum if the registry entry includes one
    if (entry.sha256) {
      const { valid, actual } = verifyDirectoryChecksum(pipelineDir, entry.sha256);
      if (!valid) {
        // Clean up the downloaded files before aborting
        try { rmSync(pipelineDir, { recursive: true, force: true }); } catch { /* ignore */ }
        console.error(
          `Checksum mismatch for ${name}. Expected: ${entry.sha256}. Got: ${actual}. Aborting install.`
        );
        process.exit(1);
      }
    }

    // Copy pipeline commands into .claude/commands/
    const extractedCommandsDir = join(pipelineDir, "commands");
    if (existsSync(extractedCommandsDir)) {
      mkdirSync(commandsDir, { recursive: true });
      cpSync(extractedCommandsDir, commandsDir, { recursive: true });
    }

    // Update state
    state = addPipeline(state, {
      name,
      version: manifest.version,
      requiredBy: names.includes(name) ? ["direct"] : names,
      checksum,
    });

    console.log(`  ✓ ${name}@${manifest.version}`);
  }

  // Write state and lockfile
  try {
    writeState(statePath, state);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  let lockfile = readLockfile(lockPath) ?? {
    lockfileVersion: 1 as const,
    generatedAt: new Date().toISOString(),
    pipelines: {},
  };

  for (const name of order) {
    const manifest = manifests.get(name);
    if (!manifest) continue;
    lockfile = addPipelineToLockfile(lockfile, {
      name,
      resolvedVersion: manifest.version,
      tarballUrl: tarballUrls.get(name) ?? "",
      checksum: checksums.get(name) ?? "",
      dependencies: (manifest.dependencies ?? []).map((d) => d.name),
    });
  }

  try {
    writeLockfile(lockPath, lockfile);
  } catch (err) {
    printError(err);
    process.exit(1);
  }

  console.log(`\n✓ Installation complete.`);
  console.log(`  State: ${statePath}`);
  console.log(`  Lockfile: ${lockPath}`);
}

