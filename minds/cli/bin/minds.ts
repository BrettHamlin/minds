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
  .command("tasks <ticket-id>")
  .description("Generate Mind-aware tasks for a ticket")
  .action(async (ticketId: string) => {
    const { runTasks } = await import("../commands/tasks.js");
    await runTasks(ticketId);
  });

program
  .command("implement <ticket-id>")
  .description("Dispatch Mind drones to implement tasks for a ticket")
  .action(async (ticketId: string, options: Record<string, unknown>) => {
    const { runImplement } = await import("../commands/implement.js");
    await runImplement(ticketId, options);
  });

program
  .command("lint <tasks-path>")
  .description("Lint a tasks.md file against the Mind registry")
  .option("--json", "Output machine-readable JSON")
  .action(async (tasksPath: string, options: { json?: boolean }) => {
    const { runLintTasks } = await import("../commands/lint-tasks.js");
    await runLintTasks(tasksPath, options);
  });

program
  .command("coverage")
  .description("Check which repo files are covered by minds' owns_files")
  .action(async () => {
    const { runCoverage } = await import("../commands/coverage.js");
    await runCoverage();
  });

program
  .command("remember <mind-name> [entry]")
  .description("Append a learning entry to a Mind's MEMORY.md")
  .option("--file <path>", "Read entry content from a file")
  .action(async (mindName: string, entry: string | undefined, options: { file?: string }) => {
    const { runRemember } = await import("../commands/remember.js");
    await runRemember(mindName, { entry, file: options.file });
  });

program.parse();
