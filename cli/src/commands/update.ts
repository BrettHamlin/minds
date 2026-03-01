import chalk from "chalk";
import { isGitRepo, getRepoRoot } from "../utils/git";
import { readVersion, writeVersion } from "../utils/version";
import { installTemplates, getTemplateDir } from "../utils/installer";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPackageVersion(): string {
  // Built (dist/): __dirname = dist/ → ../package.json = cli/package.json ✓
  // Source (src/commands/): __dirname = src/commands/ → ../../package.json = cli/package.json ✓
  const pkgPath = [join(__dirname, "..", "package.json"), join(__dirname, "..", "..", "package.json")]
    .find(p => existsSync(p));
  if (!pkgPath) throw new Error("Cannot locate package.json");
  return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
}

export async function updateCommand(options: { dryRun?: boolean; force?: boolean } = {}) {
  if (!isGitRepo()) {
    console.error(chalk.red("Error: Not a git repository."));
    process.exit(1);
  }

  const repoRoot = getRepoRoot();
  const existing = readVersion(repoRoot);

  if (!existing) {
    console.error(chalk.red("No collab installation found."));
    console.error(chalk.yellow("Run `collab init` first."));
    process.exit(1);
  }

  const currentVersion = getPackageVersion();

  if (existing.version === currentVersion && !options.force) {
    console.log(chalk.green(`Already up to date (v${currentVersion})`));
    return;
  }

  if (options.dryRun) {
    console.log(chalk.blue(`Would update: v${existing.version} → v${currentVersion}`));
    console.log(chalk.dim("Run without --dry-run to apply changes."));
    return;
  }

  // If force flag is set and versions match, still proceed
  console.log(chalk.blue(`Updating: v${existing.version} → v${currentVersion}`));

  const templateDir = getTemplateDir();
  const result = installTemplates(templateDir, repoRoot, {
    force: options.force,
    quiet: false,
  });

  // Update version tracking (preserve installedAt)
  writeVersion(repoRoot, {
    version: currentVersion,
    installedAt: existing.installedAt,
    updatedAt: new Date().toISOString(),
    previousVersion: existing.version,
  });

  console.log("");
  console.log(chalk.bold("Update complete!"));
  console.log(`  Files updated:   ${chalk.cyan(String(result.copied.length))}`);
  console.log(`  Files preserved: ${chalk.dim(String(result.skipped.length))}`);
  console.log(`  Version:         ${chalk.cyan(`v${existing.version}`)} → ${chalk.green(`v${currentVersion}`)}`);
}
