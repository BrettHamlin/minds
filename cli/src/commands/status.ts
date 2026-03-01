import chalk from "chalk";
import { isGitRepo, getRepoRoot } from "../utils/git";
import { readVersion } from "../utils/version";
import { countFiles } from "../utils/fs";
import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(dirname(__dirname), "..", "package.json"), "utf-8"));
  return pkg.version;
}

export async function statusCommand() {
  if (!isGitRepo()) {
    console.error(chalk.red("Error: Not a git repository."));
    process.exit(1);
  }

  const repoRoot = getRepoRoot();
  const version = readVersion(repoRoot);

  if (!version) {
    console.log(chalk.yellow("No collab installation found."));
    console.log(chalk.dim("Run `collab init` to install."));
    return;
  }

  const latestVersion = getPackageVersion();
  const needsUpdate = version.version !== latestVersion;

  console.log(chalk.bold(`Collab v${version.version}`));
  console.log(`  Installed: ${version.installedAt.split("T")[0]}`);
  console.log(`  Updated:   ${version.updatedAt.split("T")[0]}`);
  if (version.previousVersion) {
    console.log(`  Previous:  v${version.previousVersion}`);
  }
  console.log("");

  // Count files
  const commandCount = countFiles(join(repoRoot, ".claude/commands"), /\.md$/);
  const skillDirs = existsSync(join(repoRoot, ".claude/skills"))
    ? readdirSync(join(repoRoot, ".claude/skills")).filter(e =>
        statSync(join(repoRoot, ".claude/skills", e)).isDirectory()
      ).length
    : 0;
  const handlerCount = countFiles(join(repoRoot, ".collab/handlers"), /\.ts$/);

  console.log(`  Commands:  ${chalk.cyan(String(commandCount))}`);
  console.log(`  Skills:    ${chalk.cyan(String(skillDirs))}`);
  console.log(`  Handlers:  ${chalk.cyan(String(handlerCount))}`);
  console.log("");

  if (needsUpdate) {
    console.log(chalk.yellow(`Update available: v${latestVersion}`));
    console.log(chalk.dim("Run `collab update` to upgrade."));
  } else {
    console.log(chalk.green("Up to date."));
  }
}
