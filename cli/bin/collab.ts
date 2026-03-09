#!/usr/bin/env bun
import { Command } from "commander";
import { initCommand } from "../src/commands/init";
import { statusCommand } from "../src/commands/status";
import { updateCommand } from "../src/commands/update";

const program = new Command();

program
  .name("collab")
  .version("0.1.0")
  .description("CLI to scaffold the Collab AI-assisted development pipeline into any git repo");

program
  .command("init")
  .description("Install collab into the current git repo")
  .option("--force", "Overwrite existing installation")
  .option("--skip-verify", "Skip post-install verification")
  .option("-q, --quiet", "Suppress output")
  .action((opts) => initCommand(opts));

program
  .command("status")
  .description("Show collab installation status")
  .action(() => statusCommand());

program
  .command("update")
  .description("Update collab to latest version")
  .option("--force", "Force update even if up to date")
  .option("--dry-run", "Show what would be updated without applying")
  .option("-q, --quiet", "Suppress output")
  .action((opts) => updateCommand(opts));

program.parse();
