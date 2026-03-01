#!/usr/bin/env bun
import { program } from "commander";
import { initCommand } from "../src/commands/init";
import { updateCommand } from "../src/commands/update";
import { statusCommand } from "../src/commands/status";

program
  .name("collab")
  .description("Scaffold the Collab AI-assisted development pipeline")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize collab in the current git repo")
  .option("--force", "Overwrite existing installation")
  .option("--skip-verify", "Skip post-installation verification")
  .option("--quiet", "Minimal output")
  .action(initCommand);

program
  .command("update")
  .description("Update an existing collab installation")
  .option("--dry-run", "Show what would be updated without making changes")
  .option("--force", "Update even user-customizable files (with backup)")
  .action(updateCommand);

program
  .command("status")
  .description("Show installed collab version and check for updates")
  .action(statusCommand);

program.parse();
