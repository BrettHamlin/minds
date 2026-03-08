#!/usr/bin/env bun
import { program } from "commander";
import { updateCommand } from "../../../cli/src/commands/update";
import { statusCommand } from "../../../cli/src/commands/status";
import { repoResolve, repoAdd, repoList, repoRemove } from "../../../cli/src/commands/repo";
import { doctorCommand } from "../commands/doctor";
import { runCollabInit } from "../commands/collab-init.js";

program
  .name("collab")
  .description("Scaffold the Collab AI-assisted development pipeline")
  .version("0.1.0");

program
  .command("init")
  .description("Install collab into the current git repo")
  .option("--branch <name>", "Git branch to install from", "main")
  .option("--force", "Overwrite existing files")
  .option("--quiet", "Minimal output")
  .action(async (options: { branch?: string; force?: boolean; quiet?: boolean }) => {
    await runCollabInit(options);
  });

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

program
  .command("doctor")
  .description("Check installation health for the current collab-enabled repository")
  .option("--json", "Output results as JSON")
  .option("--path <dir>", "Path to repo root (default: current directory)")
  .action((options: { json?: boolean; path?: string }) => {
    doctorCommand({ json: options.json, repoRoot: options.path });
  });

program.parse();
