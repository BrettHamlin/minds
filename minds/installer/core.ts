import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { ensureDashboardBuilt } from "../shared/build-dashboard.js";

/** Local ensureDir — avoids cross-Mind import from cli/utils/fs. */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// Resolve source directory — works with Bun (import.meta.dir) and Node.js (fileURLToPath fallback)
const _dir: string = (import.meta as { dir?: string }).dir
  ?? dirname(fileURLToPath(import.meta.url));

/**
 * Returns the path to the core Minds source directory (minds/).
 * Works in development (Bun, minds/installer/) and production (Node.js, dist/).
 */
export function getMindsSourceDir(): string {
  // Dev: minds/installer/../ = minds/
  const devPath = join(_dir, "..");
  if (existsSync(join(devPath, "server-base.ts"))) return devPath;
  // Built: dist/../minds/
  const builtPath = join(_dir, "..", "minds");
  if (existsSync(join(builtPath, "server-base.ts"))) return builtPath;
  throw new Error(
    "Minds source directory not found. Ensure the package was built with `bun run build`."
  );
}

/** The core Mind subdirectories to copy into .minds/ */
const CORE_MINDS = [
  "router",
  "memory",
  "transport",
  "signals",
  "dashboard",
  "integrations",
  "observability",
  "instantiate",
  "fission",
] as const;

/** Shared infrastructure files/directories to copy into .minds/ */
const SHARED_INFRA_DIRS = ["shared", "contracts", "cli"] as const;
const SHARED_INFRA_FILES = [
  "server-base.ts",
  "mind.ts",
  "intent.ts",
  "bm25.ts",
  "router.ts",
  "discovery.ts",
  "embeddings.ts",
  "dispatch.ts",
  "STANDARDS.md",
] as const;

export interface MindsInstallResult {
  copied: string[];
  skipped: string[];
  errors: string[];
  bunVerified: boolean;
  dashboardBuilt: boolean;
}

/**
 * Copy core Minds and shared infrastructure to .minds/ in the target repo.
 * Generate tsconfig.json with @minds/* path alias.
 * Populate .minds/minds.json from pre-generated core registry.
 * Verify Bun runtime is installed.
 */
export function installCoreMinds(
  mindsSourceDir: string,
  repoRoot: string,
  options: { force?: boolean; quiet?: boolean } = {}
): MindsInstallResult {
  const { force = false, quiet = false } = options;
  const log = quiet ? (..._args: unknown[]) => {} : console.log;
  const result: MindsInstallResult = { copied: [], skipped: [], errors: [], bunVerified: false, dashboardBuilt: false };

  const destMindsDir = join(repoRoot, ".minds");
  ensureDir(destMindsDir);

  /** Dev artifacts that should never be copied from source into .minds/ */
  const SKIP_COPY_NAMES = new Set(["node_modules", "dist", ".turbo", "bun.lock"]);

  // Helper: recursively copy a directory
  function copyDirRecursive(src: string, dest: string) {
    ensureDir(dest);
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (SKIP_COPY_NAMES.has(entry.name)) continue;
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else {
        if (!force && existsSync(destPath)) {
          result.skipped.push(relative(repoRoot, destPath));
        } else {
          copyFileSync(srcPath, destPath);
          result.copied.push(relative(repoRoot, destPath));
        }
      }
    }
  }

  // Copy core Minds
  for (const mindName of CORE_MINDS) {
    const src = join(mindsSourceDir, mindName);
    if (!existsSync(src)) {
      if (!quiet) console.warn(`  Warning: Core Mind '${mindName}' not found at ${src}, skipping`);
      continue;
    }
    const dest = join(destMindsDir, mindName);
    copyDirRecursive(src, dest);
    log(`  Copied Mind: ${mindName}`);
  }

  // Copy shared infrastructure directories
  for (const dir of SHARED_INFRA_DIRS) {
    const src = join(mindsSourceDir, dir);
    if (!existsSync(src)) continue;
    copyDirRecursive(src, join(destMindsDir, dir));
  }

  // Copy shared infrastructure files
  for (const file of SHARED_INFRA_FILES) {
    const src = join(mindsSourceDir, file);
    const dest = join(destMindsDir, file);
    if (!existsSync(src)) continue;
    if (!force && existsSync(dest)) {
      result.skipped.push(relative(repoRoot, dest));
    } else {
      copyFileSync(src, dest);
      result.copied.push(relative(repoRoot, dest));
    }
  }

  // Copy orchestration lib
  const libSrc = join(mindsSourceDir, "lib");
  if (existsSync(libSrc)) {
    copyDirRecursive(libSrc, join(destMindsDir, "lib"));
    log("  Copied orchestration lib");
  }

  // Copy Claude Code slash commands into .claude/commands/
  const claudeCommandsDir = join(repoRoot, ".claude", "commands");
  ensureDir(claudeCommandsDir);
  const CLAUDE_COMMANDS: Array<{ src: string; dest: string }> = [
    { src: "tasks.md", dest: "minds.tasks.md" },
    { src: "implement.md", dest: "minds.implement.md" },
  ];
  for (const { src: srcName, dest: destName } of CLAUDE_COMMANDS) {
    const src = join(mindsSourceDir, "commands", srcName);
    const dest = join(claudeCommandsDir, destName);
    if (!existsSync(src)) {
      if (!quiet) console.warn(`  Warning: Command file '${srcName}' not found at ${src}, skipping`);
      continue;
    }
    if (!force && existsSync(dest)) {
      result.skipped.push(relative(repoRoot, dest));
    } else {
      copyFileSync(src, dest);
      result.copied.push(relative(repoRoot, dest));
      log(`  Installed command: .claude/commands/${destName}`);
    }
  }

  // Copy Claude Code skills into .claude/skills/
  const skillsSrcDir = join(mindsSourceDir, "skills");
  if (existsSync(skillsSrcDir)) {
    const claudeSkillsDir = join(repoRoot, ".claude", "skills");
    ensureDir(claudeSkillsDir);
    for (const skillEntry of readdirSync(skillsSrcDir, { withFileTypes: true })) {
      if (!skillEntry.isDirectory()) continue;
      const skillSrc = join(skillsSrcDir, skillEntry.name);
      const skillDest = join(claudeSkillsDir, skillEntry.name);
      copyDirRecursive(skillSrc, skillDest);
      log(`  Installed skill: .claude/skills/${skillEntry.name}`);
    }
  }

  // Generate/update tsconfig.json with @minds/* path alias
  const tsconfigPath = join(repoRoot, "tsconfig.json");
  try {
    let tsconfig: Record<string, unknown> = {};
    if (existsSync(tsconfigPath)) {
      tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8")) as Record<string, unknown>;
    }
    const compilerOptions = (tsconfig.compilerOptions ?? {}) as Record<string, unknown>;
    const paths = (compilerOptions.paths ?? {}) as Record<string, string[]>;
    paths["@minds/*"] = ["./.minds/*"];
    compilerOptions.paths = paths;
    tsconfig.compilerOptions = compilerOptions;
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
    result.copied.push("tsconfig.json");
    log("  Generated/updated tsconfig.json with @minds/* path alias");
  } catch (err) {
    result.errors.push(`tsconfig.json: ${(err as Error).message}`);
  }

  // Generate .minds/minds.json from pre-generated core registry
  const mindsJsonPath = join(destMindsDir, "minds.json");
  const coreRegistryPath = join(dirname(_dir), "installer", "core-minds-registry.json");
  if (!existsSync(mindsJsonPath) || force) {
    if (existsSync(coreRegistryPath)) {
      copyFileSync(coreRegistryPath, mindsJsonPath);
      log("  Populated .minds/minds.json from core registry");
    } else {
      writeFileSync(mindsJsonPath, "[]\n");
      log("  Generated .minds/minds.json registry placeholder (core registry not found)");
    }
    result.copied.push(".minds/minds.json");
  } else {
    result.skipped.push(".minds/minds.json");
  }

  // Verify Bun runtime
  const bunCheck = spawnSync("bun", ["--version"], { stdio: "ignore" });
  if (bunCheck.status === 0) {
    result.bunVerified = true;
    log("  Bun runtime verified");
  } else {
    result.errors.push("Bun runtime not found. Install Bun: https://bun.sh");
  }

  // Build dashboard SPA
  if (result.bunVerified) {
    const dashboardBuild = ensureDashboardBuilt(destMindsDir, quiet);
    if (dashboardBuild.skipped) {
      log("  Dashboard already built (or not present).");
    } else if (dashboardBuild.success) {
      result.dashboardBuilt = true;
      log("  Dashboard built successfully");
    } else {
      result.errors.push(`Dashboard build failed: ${dashboardBuild.error}`);
    }
  } else if (existsSync(join(destMindsDir, "dashboard", "package.json"))) {
    result.errors.push("Dashboard not built: Bun runtime not available");
  }

  return result;
}
