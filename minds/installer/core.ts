import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, chmodSync, readFileSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
// TODO(WD): CLI Mind not decoupled yet — direct import from minds/cli/utils until Wave D
import { ensureDir } from "../cli/utils/fs";

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
  const dirs = [
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
    ".specify/scripts/bash",
    ".specify/templates",
  ];

  for (const dir of dirs) {
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
