/**
 * Collab CLI — CLI dependency detection, version check, install hints
 * Detects whether required external CLIs (jq, git, bun, etc.) are present
 * and whether their versions satisfy the required semver range.
 */

import { execSync } from "node:child_process";
import { join } from "node:path";
import { satisfies, tryParse } from "./semver.js";
import { readState, writeState, addCli } from "./state.js";
import { makeError } from "../types/index.js";
import type {
  CliDependency,
  CliCheckResult,
  CliStatus,
  CollabError,
  InstalledState,
} from "../types/index.js";

// ─── Exec injection ───────────────────────────────────────────────────────────

/**
 * Injectable exec function for testing.  The default wraps execSync with
 * stdio: "pipe" so output is captured.  Tests supply a mock instead.
 */
type ExecFn = (cmd: string) => Buffer | string;

const defaultExec: ExecFn = (cmd) => execSync(cmd, { stdio: "pipe" });

// ─── CLI install strategies ───────────────────────────────────────────────────

/**
 * Per-CLI knowledge: how to detect the version and how to install.
 * To add a new CLI, add an entry here — no other file changes needed.
 */
export interface CliInstallStrategy {
  name: string;
  /** Shell command to auto-install this CLI.  null = non-installable (system tool). */
  installCmd: string | null;
  /** Flag to pass to the CLI to get its version string */
  versionFlag: string;
  /** Regex to extract the semver string from the version output */
  versionRegex: RegExp;
  /** Human-readable install instructions shown when installCmd is null */
  instructions: string;
}

export const CLI_STRATEGIES: Record<string, CliInstallStrategy> = {
  bun: {
    name: "bun",
    installCmd: "curl -fsSL https://bun.sh/install | bash",
    versionFlag: "--version",
    versionRegex: /^(\d+\.\d+\.\d+)/,
    instructions: "Install via: curl -fsSL https://bun.sh/install | bash",
  },
  node: {
    name: "node",
    installCmd: "brew install node",
    versionFlag: "--version",
    versionRegex: /^v?(\d+\.\d+\.\d+)/,
    instructions: "Install via: brew install node",
  },
  jq: {
    name: "jq",
    installCmd: "brew install jq",
    versionFlag: "--version",
    versionRegex: /jq-(\d+\.\d+(?:\.\d+)?)/,
    instructions: "Install via: brew install jq",
  },
  git: {
    name: "git",
    installCmd: null,
    versionFlag: "--version",
    versionRegex: /git version (\d+\.\d+\.\d+)/,
    instructions: "Install via your OS package manager (brew install git, apt install git)",
  },
  gh: {
    name: "gh",
    installCmd: "brew install gh",
    versionFlag: "--version",
    versionRegex: /gh version (\d+\.\d+\.\d+)/,
    instructions: "Install via: brew install gh",
  },
  tmux: {
    name: "tmux",
    installCmd: "brew install tmux",
    versionFlag: "-V",
    versionRegex: /tmux (\d+\.\d+[a-z]?)/,
    instructions: "Install via: brew install tmux",
  },
  docker: {
    name: "docker",
    installCmd: null,
    versionFlag: "--version",
    versionRegex: /Docker version (\d+\.\d+\.\d+)/,
    instructions: "Install Docker Desktop from https://docker.com",
  },
  xcodebuild: {
    name: "xcodebuild",
    installCmd: null,
    versionFlag: "-version",
    versionRegex: /Xcode (\d+\.\d+(?:\.\d+)?)/,
    instructions: "Install Xcode from the Mac App Store, then run: xcode-select --install",
  },
};

// ─── Core check functions ─────────────────────────────────────────────────────

/**
 * Check a single CLI dependency against the system.
 * Does NOT throw — returns a CliCheckResult describing the status.
 *
 * Accepts an optional execFn for testing (defaults to execSync).
 */
export function checkCli(dep: CliDependency, execFn?: ExecFn): CliCheckResult {
  const installedVersion = detectVersion(dep.name, execFn);

  if (installedVersion === null) {
    return {
      name: dep.name,
      status: "missing",
      requiredRange: dep.version,
      installHint: dep.installHint,
      required: dep.required,
    };
  }

  if (installedVersion === "unknown") {
    return {
      name: dep.name,
      status: "unknown-version",
      installedVersion: "unknown",
      requiredRange: dep.version,
      installHint: dep.installHint,
      required: dep.required,
    };
  }

  const ok = satisfies(installedVersion, dep.version);
  return {
    name: dep.name,
    status: ok ? "satisfied" : "too-old",
    installedVersion,
    requiredRange: dep.version,
    installHint: dep.installHint,
    required: dep.required,
  };
}

/**
 * Check multiple CLI dependencies. Deduplicates by name — if the same CLI is
 * required by multiple pipelines, only one check is performed (most restrictive
 * range is kept).
 */
export function checkAllClis(deps: CliDependency[], execFn?: ExecFn): CliCheckResult[] {
  const deduped = deduplicateDeps(deps);
  return deduped.map((dep) => checkCli(dep, execFn));
}

/**
 * Get all unsatisfied (missing or too-old) CLIs that are marked required.
 * Returns an empty array when all required CLIs are satisfied.
 */
export function getBlockingClis(results: CliCheckResult[]): CliCheckResult[] {
  return results.filter(
    (r) => r.required && (r.status === "missing" || r.status === "too-old")
  );
}

/**
 * Format a human-readable summary line for a CLI check result.
 */
export function formatCliResult(result: CliCheckResult): string {
  switch (result.status) {
    case "satisfied":
      return `  ✓ ${result.name} ${result.installedVersion} (required: ${result.requiredRange})`;
    case "missing":
      return `  ✗ ${result.name} — NOT FOUND (required: ${result.requiredRange})${
        result.installHint ? `\n    Install: ${result.installHint}` : ""
      }`;
    case "too-old":
      return `  ✗ ${result.name} ${result.installedVersion} — TOO OLD (required: ${result.requiredRange})${
        result.installHint ? `\n    Upgrade: ${result.installHint}` : ""
      }`;
    case "unknown-version":
      return `  ? ${result.name} — found but version undetectable (required: ${result.requiredRange})`;
  }
}

// ─── Install + full resolution flow ──────────────────────────────────────────

/**
 * Attempt to install a CLI tool using its registered strategy.
 * Returns { success, version, error? }.
 *
 * - Non-installable CLIs (installCmd: null) always return success: false with instructions.
 * - Unknown CLIs (not in CLI_STRATEGIES) return success: false.
 * - Never prompts the user — callers must prompt before calling this.
 */
export function installCli(
  name: string,
  execFn: ExecFn = defaultExec
): { success: boolean; version: string | null; error?: string } {
  const strategy = CLI_STRATEGIES[name];

  if (!strategy) {
    return { success: false, version: null, error: `Unknown CLI: ${name}` };
  }

  if (strategy.installCmd === null) {
    return { success: false, version: null, error: strategy.instructions };
  }

  try {
    execFn(strategy.installCmd);
  } catch (err) {
    return { success: false, version: null, error: String(err) };
  }

  const version = detectVersion(name, execFn);
  return { success: true, version };
}

/**
 * Full CLI dependency resolution for a pipeline install:
 *
 * 1. Convert Record<name, constraint> from pipeline.json to CliDependency[]
 * 2. For each CLI: check dedup against state (already tracked + satisfied → skip)
 * 3. Detect + check version
 * 4. For missing/old installable CLIs: print what will happen, then install
 * 5. Update installed-pipelines.json with requiredBy
 *
 * Returns { success: false } if any required CLI could not be satisfied.
 *
 * Note: callers are responsible for user prompting before calling this function.
 * This function prints status lines but does NOT call AskUserQuestion.
 */
export function resolveCliDeps(
  clis: Record<string, string>,
  pipelineName: string,
  projectRoot: string,
  opts: { execFn?: ExecFn; statePath?: string } = {}
): { success: boolean; results: CliCheckResult[] } {
  const execFn = opts.execFn ?? defaultExec;
  const statePath =
    opts.statePath ?? join(projectRoot, ".collab/state/installed-pipelines.json");

  let state: InstalledState;
  try {
    state = readState(statePath);
  } catch {
    state = {
      version: "1",
      installedAt: new Date().toISOString(),
      pipelines: {},
      clis: {},
    };
  }

  const results: CliCheckResult[] = [];
  let allSuccess = true;

  for (const [name, constraint] of Object.entries(clis)) {
    const dep: CliDependency = { name, version: constraint, required: true };

    // Dedup: if already tracked in state at a satisfying version, update requiredBy and skip
    const trackedCli = state.clis[name];
    if (trackedCli && trackedCli.version !== "unknown") {
      try {
        if (satisfies(trackedCli.version, constraint)) {
          state = addCli(state, { name, version: trackedCli.version, requiredBy: [pipelineName] });
          results.push({
            name,
            status: "satisfied",
            installedVersion: trackedCli.version,
            requiredRange: constraint,
            required: true,
          });
          continue;
        }
      } catch {
        // satisfies() threw (bad range) — fall through to live check
      }
    }

    // Unknown CLI — warn and proceed without blocking
    if (!CLI_STRATEGIES[name]) {
      console.warn(
        `Unknown CLI '${name}'. Cannot verify version or install. Proceeding anyway.`
      );
      results.push({ name, status: "missing", requiredRange: constraint, required: false });
      continue;
    }

    const result = checkCli(dep, execFn);
    results.push(result);
    console.log(formatCliResult(result));

    if (result.status === "satisfied" || result.status === "unknown-version") {
      state = addCli(state, {
        name,
        version: result.installedVersion ?? "unknown",
        requiredBy: [pipelineName],
      });
      continue;
    }

    // Missing or too-old — attempt install
    const strategy = CLI_STRATEGIES[name];

    if (strategy.installCmd === null) {
      // Non-installable system tool
      console.error(`  Cannot auto-install ${name}: ${strategy.instructions}`);
      allSuccess = false;
      continue;
    }

    console.log(`  Installing ${name} via: ${strategy.installCmd}`);
    const installResult = installCli(name, execFn);

    if (installResult.success) {
      console.log(`  ✓ ${name} installed${installResult.version ? ` (${installResult.version})` : ""}`);
      state = addCli(state, {
        name,
        version: installResult.version ?? "unknown",
        requiredBy: [pipelineName],
      });
    } else {
      console.error(`  ✗ Failed to install ${name}: ${installResult.error}`);
      allSuccess = false;
    }
  }

  // Persist updated state (non-fatal if it fails)
  try {
    writeState(statePath, state);
  } catch {
    // ignore state write errors — they don't fail the install
  }

  return { success: allSuccess, results };
}

// ─── Version detection ────────────────────────────────────────────────────────

/**
 * Detect the installed version of a CLI.
 * Returns null if not found, "unknown" if found but version undetectable,
 * or a version string.
 *
 * Accepts an optional execFn for testing (defaults to execSync with stdio:pipe).
 */
export function detectVersion(cliName: string, execFn?: ExecFn): string | null {
  const fn = execFn ?? defaultExec;
  const strategy = CLI_STRATEGIES[cliName];

  if (!strategy) {
    // Generic fallback: try `<cli> --version`
    return detectVersionGeneric(cliName, fn);
  }

  let output: string;
  try {
    output = fn(`${cliName} ${strategy.versionFlag}`).toString().trim();
  } catch {
    return null; // command not found
  }

  const match = strategy.versionRegex.exec(output);
  if (!match) return "unknown";

  // Normalize: jq outputs "1.6" (no patch) — append ".0"
  const rawVersion = match[1];
  const parts = rawVersion.split(".");
  if (parts.length === 2) return `${rawVersion}.0`;
  return rawVersion;
}

function detectVersionGeneric(cliName: string, fn: ExecFn): string | null {
  const cmds = [`${cliName} --version`, `${cliName} -version`, `${cliName} version`];

  for (const cmd of cmds) {
    try {
      const output = fn(cmd).toString().trim();
      // Try to extract first version-like string
      const match = /(\d+\.\d+(?:\.\d+)?)/.exec(output);
      if (match) {
        const rawVersion = match[1];
        const parts = rawVersion.split(".");
        return parts.length === 2 ? `${rawVersion}.0` : rawVersion;
      }
      return "unknown";
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Deduplicate CLI deps by name. If the same CLI appears multiple times,
 * merge required flags (any required → required) and keep first version range.
 */
function deduplicateDeps(deps: CliDependency[]): CliDependency[] {
  const seen = new Map<string, CliDependency>();
  for (const dep of deps) {
    if (!seen.has(dep.name)) {
      seen.set(dep.name, { ...dep });
    } else {
      const existing = seen.get(dep.name)!;
      if (dep.required && !existing.required) {
        seen.set(dep.name, { ...existing, required: true });
      }
    }
  }
  return Array.from(seen.values());
}
