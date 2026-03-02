#!/usr/bin/env bun
// ============================================================================
// create-new-feature.ts - Create a new feature branch with spec scaffolding
// ============================================================================
//
// Port of create-new-feature.sh with exact feature parity.
//
// Usage:
//   bun create-new-feature.ts [options] <feature_description>
// ============================================================================

import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  writeFileSync,
} from "fs";
import { join, dirname, basename } from "path";

// ─── Stop words (exact list from bash script) ───────────────────────────────

const STOP_WORDS = new Set([
  "i", "a", "an", "the", "to", "for", "of", "in", "on", "at", "by", "with",
  "from", "is", "are", "was", "were", "be", "been", "being", "have", "has",
  "had", "do", "does", "did", "will", "would", "should", "could", "can",
  "may", "might", "must", "shall", "this", "that", "these", "those", "my",
  "your", "our", "their", "want", "need", "add", "get", "set",
]);

// ─── Exported pure functions (for testing) ───────────────────────────────────

/**
 * Extract a ticket ID from a description string.
 * Uses the generic pattern: ([A-Z]+)-([0-9]+)
 * Returns the first match or empty string.
 */
export function extractTicketId(description: string): string {
  const match = description.match(/([A-Z]+)-([0-9]+)/);
  return match ? match[0] : "";
}

/**
 * Clean and format a branch name: lowercase, replace non-alphanums with -,
 * collapse multiple dashes, strip leading/trailing dashes.
 */
export function cleanBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-/, "")
    .replace(/-$/, "");
}

/**
 * Generate a branch name from a description using stop-word filtering.
 * Keeps words >= 3 chars that aren't stop words (or uppercase acronyms).
 * Takes first 3 words (or 4 if exactly 4 meaningful words).
 */
export function generateBranchName(description: string): string {
  const cleanName = description.toLowerCase().replace(/[^a-z0-9]/g, " ");
  const words = cleanName.split(/\s+/).filter(Boolean);

  const meaningfulWords: string[] = [];
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue;
    if (word.length >= 3) {
      meaningfulWords.push(word);
    } else {
      // Keep short words if they appear as uppercase in original (likely acronyms)
      const upperWord = word.toUpperCase();
      if (description.includes(upperWord) && /^[A-Z]+$/.test(upperWord)) {
        meaningfulWords.push(word);
      }
    }
  }

  if (meaningfulWords.length > 0) {
    let maxWords = 3;
    if (meaningfulWords.length === 4) maxWords = 4;

    return meaningfulWords.slice(0, maxWords).join("-");
  }

  // Fallback to original logic
  const cleaned = cleanBranchName(description);
  return cleaned
    .split("-")
    .filter(Boolean)
    .slice(0, 3)
    .join("-");
}

/**
 * Get the highest numeric prefix from directory entries in a specs dir.
 * Returns 0 if dir doesn't exist or has no numeric-prefixed entries.
 */
export function getHighestFromSpecs(specsDir: string): number {
  let highest = 0;

  if (!existsSync(specsDir)) return 0;

  try {
    for (const entry of readdirSync(specsDir)) {
      const fullPath = join(specsDir, entry);
      if (!statSync(fullPath).isDirectory()) continue;
      const match = entry.match(/^(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > highest) highest = num;
      }
    }
  } catch {
    return 0;
  }

  return highest;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function findRepoRoot(dir: string): string | null {
  let current = dir;
  while (current !== "/") {
    if (
      existsSync(join(current, ".git")) ||
      existsSync(join(current, ".specify"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function getHighestFromBranches(): number {
  let highest = 0;

  let branches = "";
  try {
    branches = execSync("git branch -a", { encoding: "utf-8" });
  } catch {
    return 0;
  }

  for (const line of branches.split("\n")) {
    // Clean branch name: remove leading markers and remote prefixes
    const cleanBranch = line.replace(/^[* ]+/, "").replace(/^remotes\/[^/]+\//, "");
    // Extract feature number if branch matches pattern ###-*
    const match = cleanBranch.match(/^(\d{3})-/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > highest) highest = num;
    }
  }

  return highest;
}

function checkExistingBranches(specsDir: string): number {
  // Fetch all remotes to get latest branch info (suppress errors if no remotes)
  try {
    execSync("git fetch --all --prune 2>/dev/null", {
      stdio: "ignore",
      shell: true,
    });
  } catch {
    // ignore
  }

  const highestBranch = getHighestFromBranches();
  const highestSpec = getHighestFromSpecs(specsDir);
  const maxNum = Math.max(highestBranch, highestSpec);

  return maxNum + 1;
}

// ─── Argument parsing ────────────────────────────────────────────────────────

interface ParsedArgs {
  jsonMode: boolean;
  shortName: string;
  branchNumber: string;
  useWorktree: boolean;
  worktreePath: string;
  sourceRepo: string;
  featureDescription: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    jsonMode: false,
    shortName: "",
    branchNumber: "",
    useWorktree: false,
    worktreePath: "",
    sourceRepo: "",
    featureDescription: "",
  };

  const positional: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    switch (arg) {
      case "--json":
        result.jsonMode = true;
        break;

      case "--worktree":
        result.useWorktree = true;
        break;

      case "--worktree-path": {
        i++;
        if (i >= argv.length || argv[i].startsWith("--")) {
          process.stderr.write("Error: --worktree-path requires a value\n");
          process.exit(1);
        }
        result.worktreePath = argv[i];
        result.useWorktree = true;
        break;
      }

      case "--short-name": {
        i++;
        if (i >= argv.length || argv[i].startsWith("--")) {
          process.stderr.write("Error: --short-name requires a value\n");
          process.exit(1);
        }
        result.shortName = argv[i];
        break;
      }

      case "--number": {
        i++;
        if (i >= argv.length || argv[i].startsWith("--")) {
          process.stderr.write("Error: --number requires a value\n");
          process.exit(1);
        }
        result.branchNumber = argv[i];
        break;
      }

      case "--source-repo": {
        i++;
        if (i >= argv.length || argv[i].startsWith("--")) {
          process.stderr.write("Error: --source-repo requires a value\n");
          process.exit(1);
        }
        result.sourceRepo = argv[i];
        break;
      }

      case "--help":
      case "-h": {
        const scriptName = basename(process.argv[1]);
        process.stdout.write(
          `Usage: ${scriptName} [--json] [--short-name <name>] [--number N] [--worktree] [--worktree-path <dir>] [--source-repo <path>] <feature_description>\n` +
            "\n" +
            "Options:\n" +
            "  --json                Output in JSON format\n" +
            "  --short-name <name>   Provide a custom short name (2-4 words) for the branch\n" +
            "  --number N            Specify branch number manually (overrides auto-detection)\n" +
            "  --worktree            Create a git worktree instead of switching branches\n" +
            '  --worktree-path <dir> Directory for worktrees (default: ../worktrees/ relative to repo root)\n' +
            "  --source-repo <path>  Create branch and worktree from this repo instead of the current one\n" +
            "  --help, -h            Show this help message\n" +
            "\n" +
            "Examples:\n" +
            `  ${scriptName} 'Add user authentication system' --short-name 'user-auth'\n` +
            `  ${scriptName} 'Implement OAuth2 integration for API' --number 5\n` +
            `  ${scriptName} --worktree 'Add feed caching system'\n` +
            `  ${scriptName} --worktree --worktree-path ~/worktrees 'Add feed caching'\n`
        );
        process.exit(0);
        break; // unreachable but satisfies lint
      }

      default:
        positional.push(arg);
        break;
    }
    i++;
  }

  result.featureDescription = positional.join(" ");
  return result;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.featureDescription) {
    const scriptName = basename(process.argv[1]);
    process.stderr.write(
      `Usage: ${scriptName} [--json] [--short-name <name>] [--number N] <feature_description>\n`
    );
    process.exit(1);
  }

  // Resolve repository root
  let repoRoot: string;
  let hasGit: boolean;

  try {
    repoRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
    }).trim();
    hasGit = true;
  } catch {
    const scriptDir = dirname(process.argv[1]);
    const found = findRepoRoot(scriptDir);
    if (!found) {
      process.stderr.write(
        "Error: Could not determine repository root. Please run this script from within the repository.\n"
      );
      process.exit(1);
    }
    repoRoot = found;
    hasGit = false;
  }

  // Capture calling repo root before override
  const callingRepoRoot = repoRoot;

  // Override with --source-repo if provided
  if (args.sourceRepo) {
    repoRoot = args.sourceRepo;
    hasGit = true;
  }

  process.chdir(repoRoot);

  const specsDir = join(repoRoot, "specs");
  mkdirSync(specsDir, { recursive: true });

  // Generate branch suffix
  let branchSuffix: string;
  if (args.shortName) {
    branchSuffix = cleanBranchName(args.shortName);
  } else {
    branchSuffix = generateBranchName(args.featureDescription);
  }

  // Determine branch number
  let branchNumber: string;
  if (args.branchNumber) {
    branchNumber = args.branchNumber;
  } else if (hasGit) {
    branchNumber = String(checkExistingBranches(specsDir));
  } else {
    branchNumber = String(getHighestFromSpecs(specsDir) + 1);
  }

  // Force base-10 and pad to 3 digits
  const featureNum = String(parseInt(branchNumber, 10)).padStart(3, "0");
  let branchName = `${featureNum}-${branchSuffix}`;

  // GitHub enforces a 244-byte limit on branch names
  const MAX_BRANCH_LENGTH = 244;
  if (Buffer.byteLength(branchName) > MAX_BRANCH_LENGTH) {
    const maxSuffixLength = MAX_BRANCH_LENGTH - 4; // 3 digits + 1 hyphen
    let truncatedSuffix = branchSuffix.slice(0, maxSuffixLength);
    truncatedSuffix = truncatedSuffix.replace(/-$/, "");

    const originalBranchName = branchName;
    branchName = `${featureNum}-${truncatedSuffix}`;

    process.stderr.write(
      `[specify] Warning: Branch name exceeded GitHub's 244-byte limit\n`
    );
    process.stderr.write(
      `[specify] Original: ${originalBranchName} (${Buffer.byteLength(originalBranchName)} bytes)\n`
    );
    process.stderr.write(
      `[specify] Truncated to: ${branchName} (${Buffer.byteLength(branchName)} bytes)\n`
    );
  }

  let worktreeDir = "";

  if (hasGit) {
    let currentBranch = "";
    try {
      currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf-8",
      }).trim();
    } catch {
      // ignore
    }

    if (currentBranch === branchName) {
      process.stderr.write(
        `[specify] Already on branch ${branchName}, skipping branch creation\n`
      );
    } else if (args.useWorktree) {
      let worktreePath = args.worktreePath;
      if (!worktreePath) {
        worktreePath = join(dirname(repoRoot), "worktrees");
      }
      mkdirSync(worktreePath, { recursive: true });
      worktreeDir = join(worktreePath, branchName);

      if (existsSync(worktreeDir)) {
        process.stderr.write(
          `[specify] Worktree already exists at ${worktreeDir}, reusing\n`
        );
      } else {
        execSync(`git worktree add "${worktreeDir}" -b "${branchName}" 1>&2`, {
          stdio: "inherit",
          shell: true,
        });
        process.stderr.write(
          `[specify] Created worktree at ${worktreeDir}\n`
        );
      }
    } else {
      execSync(`git checkout -b "${branchName}" 1>&2`, {
        stdio: "inherit",
        shell: true,
      });
    }
  } else {
    process.stderr.write(
      `[specify] Warning: Git repository not detected; skipped branch creation for ${branchName}\n`
    );
  }

  // Determine where specs live
  let featureDir: string;
  if (worktreeDir) {
    featureDir = join(worktreeDir, "specs", branchName);
  } else {
    featureDir = join(specsDir, branchName);
  }
  mkdirSync(featureDir, { recursive: true });

  // Create metadata.json in main repo for worktree discovery
  if (worktreeDir) {
    const mainRepoSpecDir = join(specsDir, branchName);
    mkdirSync(mainRepoSpecDir, { recursive: true });

    const ticketId = extractTicketId(args.featureDescription);
    const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    const metadata = {
      ticket_id: ticketId,
      worktree_path: worktreeDir,
      branch_name: branchName,
      created_at: createdAt,
    };

    writeFileSync(
      join(mainRepoSpecDir, "metadata.json"),
      JSON.stringify(metadata, null, 2) + "\n"
    );
    process.stderr.write(
      `[specify] Created metadata.json in ${mainRepoSpecDir}\n`
    );

    // If --source-repo was used, also write to calling repo's specs/
    if (args.sourceRepo && callingRepoRoot !== repoRoot) {
      const callingSpecDir = join(callingRepoRoot, "specs", branchName);
      mkdirSync(callingSpecDir, { recursive: true });
      writeFileSync(
        join(callingSpecDir, "metadata.json"),
        JSON.stringify(metadata, null, 2) + "\n"
      );
      process.stderr.write(
        `[specify] Also wrote metadata.json to orchestrator repo at ${callingSpecDir}\n`
      );
    }
  }

  // Copy spec template or create empty spec
  const template = join(repoRoot, ".specify", "templates", "spec-template.md");
  const specFile = join(featureDir, "spec.md");
  if (existsSync(template)) {
    copyFileSync(template, specFile);
  } else {
    writeFileSync(specFile, "");
  }

  // Output
  if (args.jsonMode) {
    const output: Record<string, string> = {
      BRANCH_NAME: branchName,
      SPEC_FILE: specFile,
      FEATURE_NUM: featureNum,
    };
    if (worktreeDir) {
      output.WORKTREE_DIR = worktreeDir;
    }
    process.stdout.write(JSON.stringify(output) + "\n");
  } else {
    process.stdout.write(`BRANCH_NAME: ${branchName}\n`);
    process.stdout.write(`SPEC_FILE: ${specFile}\n`);
    process.stdout.write(`FEATURE_NUM: ${featureNum}\n`);
    if (worktreeDir) {
      process.stdout.write(`WORKTREE_DIR: ${worktreeDir}\n`);
    }
    process.stdout.write(
      `SPECIFY_FEATURE environment variable set to: ${branchName}\n`
    );
  }
}

if (import.meta.main) {
  main();
}
