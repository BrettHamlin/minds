import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync, chmodSync } from "fs";
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

/**
 * The core Mind subdirectories to copy into .minds/.
 *
 * Each entry here is a Mind (has server.ts/MIND.md) or a shared module
 * that Minds import at runtime.
 *
 * Intentionally EXCLUDED directories (not needed in target repos):
 *   - orchestrator  — empty dir, no source code
 *   - state         — runtime-generated data (SQLite DBs, JSON state), not source
 *   - templates     — scaffolding templates used by instantiate, not runtime code
 *   - fixtures      — test fixtures (mock Minds for discovery tests)
 *   - installer     — the installer itself, not installed into target repos
 *   - commands      — copied separately into .claude/commands/
 *   - skills        — copied separately into .claude/skills/
 *   - hooks         — copied separately into .claude/hooks/
 *   - tests         — dev-only test infrastructure
 */
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
  "pipeline_core",
  "execution",
  "coordination",
  "clarify",
  "pipelang",
  "spec_api",
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
  "generate-registry.ts",
  "STANDARDS.md",
] as const;

/** Known Claude Code hook event types that can appear in settings.json */
const HOOK_EVENT_TYPES = new Set([
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
]);

/**
 * Parse a hook filename to determine its event type.
 * Convention: `EventType.name.ts` or `EventType.name.hook.ts`
 * e.g. `PreToolUse.validate.ts` -> "PreToolUse"
 * Returns undefined if no known event type is found.
 */
function parseHookEventType(filename: string): string | undefined {
  const dotIndex = filename.indexOf(".");
  if (dotIndex === -1) return undefined;
  const prefix = filename.substring(0, dotIndex);
  return HOOK_EVENT_TYPES.has(prefix) ? prefix : undefined;
}

/**
 * Returns a list of actual hook filenames in the given directory,
 * filtering out .gitkeep and non-files.
 */
export function getInstalledHookFiles(hooksDir: string): string[] {
  if (!existsSync(hooksDir)) return [];
  return readdirSync(hooksDir).filter(
    (name) => name !== ".gitkeep" && !name.startsWith(".")
  );
}

/**
 * Generate or merge Claude Code settings.json with hook registrations.
 *
 * Takes a list of hook filenames (e.g. ["PreToolUse.validate.ts"]) and
 * generates the hooks section of settings.json. If settingsPath points to
 * an existing file, its contents are preserved and hooks are merged.
 *
 * Hook filenames that don't match a known event type are skipped.
 */
export function generateClaudeSettings(
  hookFiles: string[],
  existingSettingsPath?: string,
): Record<string, unknown> {
  let settings: Record<string, unknown> = {};

  if (existingSettingsPath && existsSync(existingSettingsPath)) {
    try {
      settings = JSON.parse(readFileSync(existingSettingsPath, "utf-8")) as Record<string, unknown>;
    } catch {
      // If existing file is corrupt, start fresh
      settings = {};
    }
  }

  // Group hook files by event type
  const hooksByEvent = new Map<string, string[]>();
  for (const file of hookFiles) {
    const eventType = parseHookEventType(file);
    if (!eventType) continue;
    const existing = hooksByEvent.get(eventType) ?? [];
    existing.push(file);
    hooksByEvent.set(eventType, existing);
  }

  // Nothing to register
  if (hooksByEvent.size === 0) return settings;

  const existingHooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  for (const [eventType, files] of hooksByEvent) {
    const newEntries = files.map((file) => ({
      hooks: [
        {
          type: "command" as const,
          command: `.claude/hooks/${file}`,
        },
      ],
    }));

    const existing = existingHooks[eventType] ?? [];
    // Avoid duplicate registrations: skip entries whose command path is already present
    const existingCommands = new Set<string>();
    for (const entry of existing) {
      const hooks = (entry as Record<string, unknown>).hooks as Array<{ command?: string }> | undefined;
      if (hooks) {
        for (const h of hooks) {
          if (h.command) existingCommands.add(h.command);
        }
      }
    }

    const dedupedEntries = newEntries.filter((entry) => {
      const cmd = entry.hooks[0].command;
      return !existingCommands.has(cmd);
    });

    existingHooks[eventType] = [...existing, ...dedupedEntries];
  }

  settings.hooks = existingHooks;
  return settings;
}

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
  const SKIP_COPY_NAMES = new Set(["node_modules", "dist", ".turbo", "bun.lock", "__tests__", "tests", "smoke-result.json"]);

  /** Prefixes for test artifact directories generated by the test suite */
  const SKIP_COPY_PREFIXES = ["_ta_", "_tb_", "_tc_", "_test_"];

  /** Returns true if the entry name matches any skip rule (exact, prefix, or suffix). */
  function shouldSkipEntry(name: string): boolean {
    if (SKIP_COPY_NAMES.has(name)) return true;
    for (const prefix of SKIP_COPY_PREFIXES) {
      if (name.startsWith(prefix)) return true;
    }
    // Skip test files and SQLite databases
    if (name.endsWith(".test.ts") || name.endsWith(".test.js") || name.endsWith(".db")) return true;
    return false;
  }

  // Helper: recursively copy a directory
  function copyDirRecursive(src: string, dest: string) {
    ensureDir(dest);
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (shouldSkipEntry(entry.name)) continue;
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
    { src: "drone.launch.md", dest: "minds.drone.launch.md" },
    { src: "fission.md", dest: "minds.fission.md" },
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

  // Copy Claude Code hooks into .claude/hooks/
  const hooksSrcDir = join(mindsSourceDir, "hooks");
  if (existsSync(hooksSrcDir)) {
    const hookEntries = readdirSync(hooksSrcDir).filter(
      (name) => name !== ".gitkeep"
    );
    if (hookEntries.length > 0) {
      const claudeHooksDir = join(repoRoot, ".claude", "hooks");
      ensureDir(claudeHooksDir);
      for (const hookName of hookEntries) {
        const src = join(hooksSrcDir, hookName);
        const dest = join(claudeHooksDir, hookName);
        if (!force && existsSync(dest)) {
          result.skipped.push(relative(repoRoot, dest));
        } else {
          copyFileSync(src, dest);
          chmodSync(dest, 0o755);
          result.copied.push(relative(repoRoot, dest));
          log(`  Installed hook: .claude/hooks/${hookName}`);
        }
      }
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

  // Install CLI dependencies (commander) scoped to .minds/
  if (result.bunVerified) {
    const mindsPackageJson = join(destMindsDir, "package.json");
    if (!existsSync(mindsPackageJson)) {
      writeFileSync(mindsPackageJson, JSON.stringify({
        name: "minds-runtime",
        version: "0.0.1",
        private: true,
      }, null, 2) + "\n");
      log("  Created .minds/package.json");
    }
    const addCmd = spawnSync("bun", ["add", "commander"], {
      cwd: destMindsDir,
      stdio: "pipe",
    });
    if (addCmd.status === 0) {
      log("  Installed commander dependency in .minds/");
    } else {
      const stderr = addCmd.stderr?.toString().trim() ?? "unknown error";
      result.errors.push(
        `Failed to install commander in .minds/ (run 'bun add commander' in .minds/ manually): ${stderr}`
      );
    }
  }

  // Register hooks in .claude/settings.json
  const installedHookFiles = getInstalledHookFiles(join(repoRoot, ".claude", "hooks"));
  if (installedHookFiles.length > 0) {
    try {
      const settingsPath = join(repoRoot, ".claude", "settings.json");
      const newSettings = generateClaudeSettings(installedHookFiles, settingsPath);
      writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2) + "\n");
      result.copied.push(".claude/settings.json");
      log("  Generated/updated .claude/settings.json with hook registrations");
    } catch (err) {
      result.errors.push(`.claude/settings.json: ${(err as Error).message}`);
    }
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
