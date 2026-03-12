#!/usr/bin/env bun
import { program } from "commander";

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
    const { runMindsInit } = await import("../commands/minds-init.js");
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
  .option("--offline", "Use deterministic naming (no LLM)")
  .action(async (targetDir: string | undefined, options) => {
    const { runFission } = await import("../commands/fission.js");
    await runFission(targetDir, options);
  });

program
  .command("implement <ticket-id>")
  .description("Dispatch Mind drones to implement tasks for a ticket")
  .action(async (ticketId: string, options: Record<string, unknown>) => {
    const { runImplement } = await import("../commands/implement.js");
    await runImplement(ticketId, options);
  });

program
  .command("coverage")
  .description("Check which repo files are covered by minds' owns_files")
  .action(async () => {
    const { runCoverage } = await import("../commands/coverage.js");
    await runCoverage();
  });

program.parse();
