#!/usr/bin/env bun
import { program } from "commander";
import { runMindsInit } from "../commands/minds-init.js";

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

program.parse();
