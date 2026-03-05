#!/usr/bin/env bun
import { program } from "commander";
import { initCommand } from "../src/commands/init";
import { updateCommand } from "../src/commands/update";
import { statusCommand } from "../src/commands/status";
import { repoResolve, repoAdd, repoList, repoRemove } from "../src/commands/repo";

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

const repo = program
  .command("repo")
  .description("Manage registered repo paths (~/.collab/repos.json)");

repo
  .command("resolve <repo-id>")
  .description("Print the local path for a repo ID (exit 1 if not found)")
  .action(repoResolve);

repo
  .command("add <repo-id> <path>")
  .description("Register a repo ID with its local path")
  .action(repoAdd);

repo
  .command("list")
  .description("List all registered repos")
  .action(repoList);

repo
  .command("remove <repo-id>")
  .description("Remove a registered repo")
  .action(repoRemove);

program.parse();
