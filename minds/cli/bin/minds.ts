#!/usr/bin/env bun
import { program } from "commander";
import { runMindsInit } from "../commands/minds-init.js";
import { runFission } from "../commands/fission.js";

program
  .name("minds")
  .description("Install and manage the Minds architecture")
  .version("0.1.0");

program
  .command("init")
  .description("Install Minds into the current git repo")
  .option("--force", "Overwrite existing files")
  .option("--quiet", "Minimal output")
  .action(async (options: { force?: boolean; quiet?: boolean }) => {
    await runMindsInit(options);
  });

program
  .command("fission [target-dir]")
  .description("Analyze codebase and scaffold domain Minds")
  .option("--language <lang>", "Language to analyze (default: auto-detect)")
  .option("--hub-threshold <n>", "Fan-in percentile for hub detection", "95")
  .option("--resolution <n>", "Leiden resolution parameter", "1.0")
  .option("--output <path>", "Write proposed map JSON to file")
  .option("--dry-run", "Show proposed map without scaffolding")
  .option("--yes", "Skip approval prompt")
  .option("--offline", "Use deterministic naming (no LLM)")
  .action(async (targetDir: string | undefined, options) => {
    await runFission(targetDir, options);
  });

program.parse();
