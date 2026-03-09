import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, dirname } from "path";
import chalk from "chalk";
import { isGitRepo, getRepoRoot } from "../../../minds/cli/utils/git";
import { readVersion, writeVersion } from "../../../minds/cli/utils/version";
import { countFiles } from "../../../minds/cli/utils/fs";
import { installTemplates, getTemplateDir } from "../../../minds/installer/core";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface InitOptions {
  force?: boolean;
  skipVerify?: boolean;
  quiet?: boolean;
}

export async function initCommand(options: InitOptions = {}) {
  const { force = false, skipVerify = false, quiet = false } = options;

  // 1. Validate environment
  if (!isGitRepo()) {
    console.error(chalk.red("Error: Not a git repository."));
    console.error(chalk.yellow("Run `git init` first, or navigate to a git repo."));
    process.exit(1);
  }

  const repoRoot = getRepoRoot();
  const log = quiet ? (..._args: unknown[]) => {} : console.log;

  // 2. Check for existing installation
  const existingVersion = readVersion(repoRoot);
  if (existingVersion && !force) {
    console.error(chalk.yellow(`Collab v${existingVersion.version} is already installed.`));
    console.error(chalk.yellow("Use --force to overwrite, or `collab update` to update."));
    process.exit(1);
  }

  const templateDir = getTemplateDir();
  log(chalk.blue("Installing collab workflow..."));
  log("");

  // 3. Install templates using shared installer
  const result = installTemplates(templateDir, repoRoot, { force, quiet });

  log("");
  log(chalk.blue("Setting permissions..."));
  log(chalk.green("  + Executable permissions set"));

  // 4. Write version tracking
  // Built (dist/): __dirname = dist/ → ../package.json = cli/package.json ✓
  // Source (src/commands/): __dirname = src/commands/ → ../../package.json = cli/package.json ✓
  const pkgPath = [join(__dirname, "..", "package.json"), join(__dirname, "..", "..", "package.json")]
    .find(p => existsSync(p));
  if (!pkgPath) throw new Error("Cannot locate package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const now = new Date().toISOString();
  writeVersion(repoRoot, {
    version: pkg.version,
    installedAt: existingVersion?.installedAt ?? now,
    updatedAt: now,
    ...(existingVersion ? { previousVersion: existingVersion.version } : {}),
  });
  log(chalk.green(`  + Version tracking (v${pkg.version})`));

  // 5. Verify installation
  if (!skipVerify) {
    log("");
    log(chalk.blue("Verifying installation..."));

    const criticalFiles = [
      ".claude/commands/collab.run.md",
      ".claude/commands/collab.specify.md",
      ".claude/commands/collab.clarify.md",
      ".claude/commands/collab.plan.md",
      ".claude/commands/collab.implement.md",
      ".claude/commands/collab.blindqa.md",
      ".collab/config/pipeline.json",
      ".collab/handlers/emit-question-signal.ts",
      ".collab/handlers/emit-blindqa-signal.ts",
      ".collab/version.json",
    ];

    let allPresent = true;
    for (const file of criticalFiles) {
      if (!existsSync(join(repoRoot, file))) {
        console.error(chalk.red(`  x Missing: ${file}`));
        allPresent = false;
      }
    }

    if (allPresent) {
      log(chalk.green(`  + All ${criticalFiles.length} critical files verified`));
    } else {
      console.error(chalk.red("\nInstallation verification failed. Some critical files are missing."));
      process.exit(1);
    }
  }

  // 6. Print summary
  log("");
  log(chalk.bold("Installation complete!"));
  log("");

  const commandCount = countFiles(join(repoRoot, ".claude/commands"), /\.md$/);
  const skillDirs = existsSync(join(repoRoot, ".claude/skills"))
    ? readdirSync(join(repoRoot, ".claude/skills")).filter(e =>
        statSync(join(repoRoot, ".claude/skills", e)).isDirectory()
      ).length
    : 0;
  const handlerCount = countFiles(join(repoRoot, ".collab/handlers"), /\.ts$/);

  log(`  Commands:  ${chalk.cyan(String(commandCount))}`);
  log(`  Skills:    ${chalk.cyan(String(skillDirs))}`);
  log(`  Handlers:  ${chalk.cyan(String(handlerCount))}`);
  log(`  Files:     ${chalk.cyan(String(result.copied.length))} copied, ${chalk.dim(String(result.skipped.length))} preserved`);
  log(`  Version:   ${chalk.cyan(`v${pkg.version}`)}`);
  log("");

  // List available commands
  log(chalk.bold("Available commands:"));
  const commands = readdirSync(join(repoRoot, ".claude/commands"))
    .filter(f => f.endsWith(".md") && f.startsWith("collab."))
    .map(f => "/" + f.replace(".md", ""))
    .sort();
  for (const cmd of commands) {
    log(`  ${chalk.green(cmd)}`);
  }
  log("");
}
