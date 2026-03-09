import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

/** Local ensureDir — avoids cross-Mind import from cli/utils/fs. */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// Resolve source directory — works with Bun (import.meta.dir) and Node.js (fileURLToPath fallback)
const _dir: string = (import.meta as { dir?: string }).dir
  ?? dirname(fileURLToPath(import.meta.url));

/**
 * Returns the path to the portable Minds source directory (minds/).
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

/** The portable Mind subdirectories to copy into .minds/ */
const PORTABLE_MINDS = [
  "router",
  "memory",
  "transport",
  "signals",
  "dashboard",
  "integrations",
  "observability",
] as const;

/** Shared infrastructure files/directories to copy into .minds/ */
const SHARED_INFRA_DIRS = ["shared", "contracts"] as const;
const SHARED_INFRA_FILES = ["server-base.ts", "mind.ts"] as const;

export interface MindsInstallResult {
  copied: string[];
  skipped: string[];
  errors: string[];
  bunVerified: boolean;
  dashboardBuilt: boolean;
}

/**
 * Copy portable Minds and shared infrastructure to .minds/ in the target repo.
 * Generate tsconfig.json with @minds/* path alias.
 * Generate initial .minds/minds.json registry placeholder.
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

  // Copy portable Minds
  for (const mindName of PORTABLE_MINDS) {
    const src = join(mindsSourceDir, mindName);
    if (!existsSync(src)) {
      if (!quiet) console.warn(`  Warning: Portable Mind '${mindName}' not found at ${src}, skipping`);
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

  // Generate initial .minds/minds.json registry placeholder
  const mindsJsonPath = join(destMindsDir, "minds.json");
  if (!existsSync(mindsJsonPath) || force) {
    writeFileSync(mindsJsonPath, "[]\n");
    result.copied.push(".minds/minds.json");
    log("  Generated .minds/minds.json registry placeholder");
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
  const dashboardDest = join(destMindsDir, "dashboard");
  const dashboardPkgJson = join(dashboardDest, "package.json");
  if (result.bunVerified && existsSync(dashboardPkgJson)) {
    const stdio = quiet ? "ignore" : "inherit";
    log("  Installing dashboard dependencies...");
    const installProc = spawnSync("bun", ["install"], { cwd: dashboardDest, stdio });
    if (installProc.status !== 0) {
      result.errors.push("Dashboard build failed: bun install returned non-zero exit code");
    } else {
      log("  Building dashboard SPA...");
      const buildProc = spawnSync("bun", ["run", "build.ts"], { cwd: dashboardDest, stdio });
      if (buildProc.status !== 0) {
        result.errors.push("Dashboard build failed: bun run build.ts returned non-zero exit code");
      } else {
        result.dashboardBuilt = true;
        log("  Dashboard built successfully");
      }
    }
  } else if (!result.bunVerified && existsSync(dashboardPkgJson)) {
    result.errors.push("Dashboard not built: Bun runtime not available");
  }

  return result;
}
