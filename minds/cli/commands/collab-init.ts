import { execSync } from "node:child_process";
import { join } from "node:path";
import { installTemplates, getTemplateDir } from "../../installer/core.js";

const COLLAB_REPO = "https://github.com/BrettHamlin/collab";

export interface CollabInitOptions {
  branch?: string;
  force?: boolean;
  quiet?: boolean;
}

/**
 * Install collab into the current git repo.
 * Shared implementation used by both CLI entry points (index.ts and bin/collab.ts).
 */
export async function runCollabInit(options: CollabInitOptions = {}): Promise<void> {
  const { branch = "main", force = false, quiet = false } = options;
  const log = quiet ? (..._args: unknown[]) => {} : console.log;

  let repoRoot: string;
  try {
    repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    console.error("Error: Not in a git repository. Run `git init` first.");
    process.exit(1);
    return;
  }

  let templateDir: string;
  let tempDir: string | null = null;
  try {
    templateDir = getTemplateDir();
  } catch {
    tempDir = `/tmp/collab-init-${process.pid}`;
    log(`Cloning collab from GitHub (branch: ${branch})...`);
    try {
      execSync(
        `git clone --depth 1 --branch "${branch}" "${COLLAB_REPO}" "${tempDir}"`,
        { stdio: "inherit" }
      );
    } catch {
      console.error("Error: Failed to clone collab repository.");
      if (tempDir) {
        try { execSync(`rm -rf "${tempDir}"`); } catch { /* non-fatal */ }
      }
      process.exit(1);
      return;
    }
    templateDir = join(tempDir, "minds", "templates");
  }

  log("Installing collab...");
  const result = installTemplates(templateDir, repoRoot, { force, quiet });

  if (tempDir) {
    try { execSync(`rm -rf "${tempDir}"`); } catch { /* non-fatal */ }
  }

  if (result.errors.length > 0) {
    console.error("\nInstallation completed with errors:");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
    return;
  }

  log("\nInstallation complete!");
  log(`  Copied:  ${result.copied.length} files`);
  if (result.skipped.length > 0) {
    log(`  Skipped: ${result.skipped.length} files (already exist)`);
  }
}
