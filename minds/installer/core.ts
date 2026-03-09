import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, chmodSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

/** Local ensureDir — avoids cross-Mind import from cli/utils/fs. */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Doctor types
// ---------------------------------------------------------------------------

/** A single installation health check with a name, pass/fail result, and message. */
export interface DoctorCheck {
  name: string;
  pass: boolean;
  message: string;
}

/** Aggregated result of all doctor checks. */
export interface DoctorResult {
  checks: DoctorCheck[];
  /** true only when every individual check passed */
  pass: boolean;
}

// Resolve template directory — works with Bun (import.meta.dir) and Node.js (fileURLToPath fallback)
const _dir: string = (import.meta as { dir?: string }).dir
  ?? dirname(fileURLToPath(import.meta.url));

/**
 * Returns the path to the bundled templates directory.
 * Templates live at minds/templates/ in the repo root.
 * Works in development (Bun, minds/installer/) and production (Node.js, dist/).
 */
export function getTemplateDir(): string {
  // Dev: running source directly — minds/installer/../templates = minds/templates
  const devPath = join(_dir, "..", "templates");
  if (existsSync(devPath)) return devPath;
  // Built: running dist/cli.js — dist/../minds/templates
  const builtPath = join(_dir, "..", "minds", "templates");
  if (existsSync(builtPath)) return builtPath;
  throw new Error(
    "Template directory not found. Ensure the package was built with `bun run build`."
  );
}

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
export function installPortableMinds(
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

export interface InstallResult {
  copied: string[];
  skipped: string[];
  errors: string[];
}

// Files that should NOT be overwritten if they already exist
const SKIP_IF_EXISTS = new Set([
  "config/verify-config.json",
  "config/verify-patterns.json",
  "claude-settings.json",
]);

// Directories that should not be overwritten if they exist
const SKIP_DIRS_IF_EXISTS = new Set([
  "config/gates",
]);

// ---------------------------------------------------------------------------
// Installation directory list — single source of truth used by both
// installTemplates (creation) and checkFilePresence (verification).
// ---------------------------------------------------------------------------
export const INSTALL_DIRS = [
  ".claude/commands",
  ".claude/skills",
  ".collab/handlers",
  ".collab/scripts/orchestrator/commands",
  ".collab/scripts",
  ".collab/state/pipeline-registry",
  ".collab/state/pipeline-groups",
  ".collab/memory",
  ".collab/config/orchestrator-contexts",
  ".collab/config/displays",
  ".collab/config/gates",
  ".collab/lib/pipeline",
  ".collab/hooks",
  ".collab/transport",
  ".specify/scripts/bash",
  ".specify/templates",
] as const;

/**
 * Install templates from templateDir into repoRoot.
 * Handles directory creation, file copying with skip-if-exists logic,
 * executable permissions, and special file handling (settings, constitution).
 */
export function installTemplates(
  templateDir: string,
  repoRoot: string,
  options: { force?: boolean; quiet?: boolean } = {}
): InstallResult {
  const { force = false, quiet = false } = options;
  const log = quiet ? (..._args: unknown[]) => {} : console.log;
  const result: InstallResult = { copied: [], skipped: [], errors: [] };

  // 1. Create directory structure
  for (const dir of INSTALL_DIRS) {
    ensureDir(join(repoRoot, dir));
  }

  // 2. Copy templates
  function copyTemplateDir(
    templateSubdir: string,
    destSubdir: string,
    opts: { skipIfExists?: boolean } = {}
  ) {
    const src = join(templateDir, templateSubdir);
    if (!existsSync(src)) {
      if (!quiet) console.warn(`  Warning: Template ${templateSubdir} not found, skipping`);
      return;
    }

    const dest = join(repoRoot, destSubdir);
    ensureDir(dest);

    function walkAndCopy(srcDir: string, destDir: string) {
      for (const entry of readdirSync(srcDir)) {
        const srcPath = join(srcDir, entry);
        const destPath = join(destDir, entry);
        const stat = statSync(srcPath);

        if (stat.isDirectory()) {
          const relPath = relative(join(templateDir, templateSubdir), srcPath);
          const templateRelPath = templateSubdir + "/" + relPath;
          if (opts.skipIfExists && SKIP_DIRS_IF_EXISTS.has(templateRelPath) && existsSync(destPath) && !force) {
            result.skipped.push(relative(repoRoot, destPath));
            continue;
          }
          ensureDir(destPath);
          walkAndCopy(srcPath, destPath);
        } else {
          const relPath = relative(templateDir, srcPath);
          if (opts.skipIfExists && SKIP_IF_EXISTS.has(relPath) && existsSync(destPath) && !force) {
            result.skipped.push(relative(repoRoot, destPath));
            continue;
          }
          ensureDir(dirname(destPath));
          copyFileSync(srcPath, destPath);
          result.copied.push(relative(repoRoot, destPath));
        }
      }
    }

    walkAndCopy(src, dest);
  }

  // Commands (always overwrite)
  copyTemplateDir("commands", ".claude/commands");

  // Skills (always overwrite)
  copyTemplateDir("skills", ".claude/skills");

  // Handlers (always overwrite)
  copyTemplateDir("handlers", ".collab/handlers");

  // Orchestrator scripts (always overwrite)
  copyTemplateDir("orchestrator", ".collab/scripts/orchestrator");

  // Shared pipeline library (always overwrite — required by orchestrator scripts)
  copyTemplateDir("lib-pipeline", ".collab/lib/pipeline");

  // Hooks (always overwrite — Claude Code settings.json references these)
  copyTemplateDir("hooks", ".collab/hooks");

  // Transport (always overwrite — bus server + helpers)
  copyTemplateDir("transport", ".collab/transport");

  // Top-level scripts
  const scriptsDir = join(templateDir, "scripts");
  if (existsSync(scriptsDir)) {
    for (const file of readdirSync(scriptsDir)) {
      const srcPath = join(scriptsDir, file);
      if (statSync(srcPath).isFile()) {
        copyFileSync(srcPath, join(repoRoot, ".collab/scripts", file));
        result.copied.push(join(".collab/scripts", file));
      }
    }
  }

  // Config (mixed policy)
  copyTemplateDir("config", ".collab/config", { skipIfExists: true });

  // Specify scripts
  copyTemplateDir("specify-scripts", ".specify/scripts");

  // Specify templates
  copyTemplateDir("specify-templates", ".specify/templates");

  // Settings (skip if exists)
  const settingsTemplate = join(templateDir, "claude-settings.json");
  const settingsDest = join(repoRoot, ".claude/settings.json");
  if (existsSync(settingsTemplate)) {
    if (existsSync(settingsDest) && !force) {
      result.skipped.push(".claude/settings.json");
    } else {
      copyFileSync(settingsTemplate, settingsDest);
      result.copied.push(".claude/settings.json");
    }
  }

  // minds.json — placeholder so /minds.tasks finds the file without erroring (skip if exists)
  const mindsJsonDest = join(repoRoot, ".collab/minds.json");
  if (!existsSync(mindsJsonDest) || force) {
    writeFileSync(mindsJsonDest, "[]\n");
    result.copied.push(".collab/minds.json");
  } else {
    result.skipped.push(".collab/minds.json");
  }

  // Constitution (skip if exists)
  const constitutionDest = join(repoRoot, ".collab/memory/constitution.md");
  const constitutionTemplate = join(templateDir, "specify-templates/constitution-template.md");
  if (!existsSync(constitutionDest) || force) {
    if (existsSync(constitutionTemplate)) {
      copyFileSync(constitutionTemplate, constitutionDest);
      result.copied.push(".collab/memory/constitution.md");
    }
  } else {
    result.skipped.push(".collab/memory/constitution.md");
  }

  // 3. Set permissions
  function setExecRecursive(dir: string, pattern: RegExp) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { recursive: true })) {
      const fullPath = join(dir, entry.toString());
      if (statSync(fullPath).isFile() && pattern.test(entry.toString())) {
        chmodSync(fullPath, 0o755);
      }
    }
  }

  setExecRecursive(join(repoRoot, ".collab/scripts"), /\.(sh|ts)$/);
  setExecRecursive(join(repoRoot, ".collab/handlers"), /\.ts$/);
  setExecRecursive(join(repoRoot, ".claude/commands"), /\.(sh|ts)$/);

  return result;
}

// ---------------------------------------------------------------------------
// Doctor checks
// ---------------------------------------------------------------------------

/** Files that must exist after a successful install (beyond the dirs list). */
const INSTALL_FILES = [
  ".claude/settings.json",
  ".collab/memory/constitution.md",
  ".collab/minds.json",
];

/**
 * Verify that all expected installed directories and key files exist under repoRoot.
 */
export function checkFilePresence(repoRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  for (const dir of INSTALL_DIRS) {
    const full = join(repoRoot, dir);
    const exists = existsSync(full) && statSync(full).isDirectory();
    checks.push({
      name: `dir: ${dir}`,
      pass: exists,
      message: exists
        ? `Directory exists: ${dir}`
        : `Missing directory: ${dir}`,
    });
  }

  for (const file of INSTALL_FILES) {
    const full = join(repoRoot, file);
    const exists = existsSync(full) && statSync(full).isFile();
    checks.push({
      name: `file: ${file}`,
      pass: exists,
      message: exists ? `File exists: ${file}` : `Missing file: ${file}`,
    });
  }

  return checks;
}

/** Directories and their script patterns that must be executable after install. */
const EXEC_TARGETS: Array<{ dir: string; pattern: RegExp }> = [
  { dir: ".collab/scripts", pattern: /\.(sh|ts)$/ },
  { dir: ".collab/handlers", pattern: /\.ts$/ },
  { dir: ".claude/commands", pattern: /\.(sh|ts)$/ },
];

/**
 * Verify that all installed scripts and handlers are executable (mode includes 0o111).
 * Returns one check per file found.
 */
export function checkScriptPermissions(repoRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  for (const { dir, pattern } of EXEC_TARGETS) {
    const absDir = join(repoRoot, dir);
    if (!existsSync(absDir)) continue;

    for (const entry of readdirSync(absDir, { recursive: true })) {
      const rel = entry.toString();
      if (!pattern.test(rel)) continue;

      const fullPath = join(absDir, rel);
      const st = statSync(fullPath);
      if (!st.isFile()) continue;

      const isExec = (st.mode & 0o111) !== 0;
      const displayPath = join(dir, rel);
      checks.push({
        name: `perm: ${displayPath}`,
        pass: isExec,
        message: isExec
          ? `Executable: ${displayPath}`
          : `Not executable (mode ${(st.mode & 0o777).toString(8)}): ${displayPath}`,
      });
    }
  }

  return checks;
}

/** Required top-level keys in pipeline.json. */
const PIPELINE_CONFIG_REQUIRED_FIELDS = ["version", "phases"] as const;

/**
 * Validate that the installed pipeline config (.collab/config/pipeline.json)
 * is parseable JSON and contains the required top-level fields.
 */
export function checkConfigSchema(repoRoot: string): DoctorCheck[] {
  const configPath = join(repoRoot, ".collab/config/pipeline.json");

  if (!existsSync(configPath)) {
    return [
      {
        name: "config: pipeline.json",
        pass: false,
        message: `Missing pipeline config: .collab/config/pipeline.json`,
      },
    ];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    return [
      {
        name: "config: pipeline.json",
        pass: false,
        message: `Invalid JSON in .collab/config/pipeline.json: ${(err as Error).message}`,
      },
    ];
  }

  const checks: DoctorCheck[] = [];
  const obj = parsed as Record<string, unknown>;

  for (const field of PIPELINE_CONFIG_REQUIRED_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(obj, field);
    checks.push({
      name: `config: pipeline.json#${field}`,
      pass: present,
      message: present
        ? `Required field present: ${field}`
        : `Missing required field in pipeline.json: "${field}"`,
    });
  }

  return checks;
}

/**
 * Run all doctor checks against an installed repoRoot and return the aggregated result.
 */
export function runDoctorChecks(repoRoot: string): DoctorResult {
  const checks: DoctorCheck[] = [
    ...checkFilePresence(repoRoot),
    ...checkScriptPermissions(repoRoot),
    ...checkConfigSchema(repoRoot),
  ];

  return {
    checks,
    pass: checks.every((c) => c.pass),
  };
}
