import { execSync } from "node:child_process";
import { getMindsSourceDir, installCoreMinds } from "../../installer/core.js";

export interface MindsInitOptions {
  force?: boolean;
  quiet?: boolean;
}

/**
 * Install core Minds into the current git repo's .minds/ directory.
 */
export async function runMindsInit(options: MindsInitOptions = {}): Promise<void> {
  const { force = false, quiet = false } = options;
  const log = quiet ? (..._args: unknown[]) => {} : console.log;

  let repoRoot: string;
  try {
    repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    console.error("Error: Not in a git repository. Run `git init` first.");
    process.exit(1);
    return;
  }

  let mindsSourceDir: string;
  try {
    mindsSourceDir = getMindsSourceDir();
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  log("Installing Minds...");
  const result = installCoreMinds(mindsSourceDir, repoRoot, { force, quiet });

  if (!result.bunVerified) {
    console.warn("\nWarning: Bun runtime not found. Install Bun: https://bun.sh");
  }

  const nonBunErrors = result.errors.filter((e) => !e.includes("Bun"));
  if (nonBunErrors.length > 0) {
    console.error("\nMind installation completed with errors:");
    for (const e of result.errors) console.error(`  - ${e}`);
  }

  log("\nInstallation complete!");
  log(`  Copied:  ${result.copied.length} files`);
  if (result.skipped.length > 0) {
    log(`  Skipped: ${result.skipped.length} files (already exist)`);
  }
  if (result.dashboardBuilt) {
    log("  Dashboard: built successfully");
  } else if (result.errors.some((e) => e.toLowerCase().includes("dashboard"))) {
    log("  Dashboard: build failed (see errors above)");
  }
}
