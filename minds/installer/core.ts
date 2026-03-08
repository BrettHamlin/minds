import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, chmodSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

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
