#!/usr/bin/env bun
/**
 * minds — Minds architecture installer CLI
 *
 * Usage:
 *   minds init [--force] [--quiet]   Install Minds into the current git repo
 *
 * Zero external npm dependencies — Bun built-ins + Node standard APIs only.
 */

import { runMindsInit } from "./commands/minds-init.js";

const VERSION = "0.1.0";

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`minds v${VERSION} — Minds architecture installer

Usage:
  minds init [--force] [--quiet]     Install Minds into the current git repo

Global flags:
  --force             Overwrite existing files
  --quiet             Minimal output
  --help, -h          Show this help
  --version, -v       Show version`);
}

function parseFlags(rawArgs: string[]): {
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rawArgs[i + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      const key = arg.slice(1);
      flags[key] = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

async function main(): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    console.log(`minds v${VERSION}`);
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);
  const { flags } = parseFlags(subArgs);

  const force = flags.force === true;
  const quiet = flags.quiet === true;

  // --- minds init ---
  if (subcommand === "init") {
    if (flags.help || flags.h) {
      console.log("Usage: minds init [--force] [--quiet]");
      console.log("");
      console.log("Install Minds into the current git repository.");
      console.log("");
      console.log("Options:");
      console.log("  --force           Overwrite existing files");
      console.log("  --quiet           Minimal output");
      return;
    }

    await runMindsInit({ force, quiet });
    return;
  }

  console.error(`Unknown command: "${subcommand}"`);
  console.error("Run: minds --help");
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
