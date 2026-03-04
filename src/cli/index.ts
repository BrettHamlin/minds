#!/usr/bin/env bun
/**
 * collab — standalone pipeline package manager CLI
 *
 * Usage:
 *   collab pipelines                    Browse available packs + pipelines
 *   collab pipelines install <name>     Install by name
 *   collab pipelines list               List installed pipelines
 *   collab pipelines update [name]      Check/apply updates
 *   collab pipelines remove <name>      Uninstall pipeline
 *   collab pipeline init                Scaffold pipeline.json
 *   collab pipeline validate            Validate pipeline.json
 *
 * Build as single binary:
 *   bun build src/cli/index.ts --compile --outfile collab
 *
 * Zero external npm dependencies — Bun built-ins + Node standard APIs only.
 */

import { browse } from "./commands/pipelines/browse.js";
import { install } from "./commands/pipelines/install.js";
import { list } from "./commands/pipelines/list.js";
import { update } from "./commands/pipelines/update.js";
import { remove } from "./commands/pipelines/remove.js";
import { init } from "./commands/pipeline/init.js";
import { validate } from "./commands/pipeline/validate.js";

const VERSION = "0.1.0";

const args = process.argv.slice(2);

function printHelp(): void {
  console.log(`collab v${VERSION} — Pipeline package manager

Usage:
  collab pipelines                         Browse available packs + pipelines
  collab pipelines install <name...>       Install pipeline(s) + their deps
  collab pipelines list                    List installed pipelines
  collab pipelines update [<name...>]      Check for and apply updates
  collab pipelines remove <name...>        Uninstall pipeline(s)
  collab pipeline init [--name <n>] [--type pipeline|pack]  Scaffold pipeline.json
  collab pipeline validate [--path <f>]    Validate a pipeline.json

Global flags:
  --registry <url>    Override registry URL (default: COLLAB_REGISTRY env var)
  --state <path>      Override state file path
  --lock <path>       Override lockfile path
  --json              Output JSON instead of human-readable text
  --yes, -y           Skip confirmation prompts
  --force             Overwrite existing files
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
      // Short flags
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
    console.log(`collab v${VERSION}`);
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);
  const { positional, flags } = parseFlags(subArgs);

  const registryUrl = typeof flags.registry === "string" ? flags.registry : undefined;
  const statePath = typeof flags.state === "string" ? flags.state : undefined;
  const lockPath = typeof flags.lock === "string" ? flags.lock : undefined;
  const installDir = typeof flags["install-dir"] === "string" ? flags["install-dir"] : undefined;
  const json = flags.json === true;
  const yes = flags.yes === true || flags.y === true;
  const force = flags.force === true;

  // ─── collab pipelines ─────────────────────────────────────────────────────
  if (subcommand === "pipelines") {
    const action = positional[0];
    const rest = positional.slice(1);

    if (!action || action === "browse" || flags.help || flags.h) {
      // Default: browse
      if (flags.help || flags.h) {
        console.log("Usage: collab pipelines [browse] [--registry <url>] [--json]");
        return;
      }
      await browse({ registryUrl, json });
      return;
    }

    if (action === "install") {
      if (rest.length === 0) {
        console.error("Usage: collab pipelines install <name> [<name>...]");
        process.exit(1);
      }
      await install(rest, { registryUrl, statePath, lockPath, installDir, force });
      return;
    }

    if (action === "list") {
      await list({ statePath, json });
      return;
    }

    if (action === "update") {
      await update(rest, { registryUrl, statePath, lockPath, installDir, yes, json });
      return;
    }

    if (action === "remove") {
      if (rest.length === 0) {
        console.error("Usage: collab pipelines remove <name> [<name>...]");
        process.exit(1);
      }
      await remove(rest, { statePath, lockPath, installDir });
      return;
    }

    console.error(`Unknown pipelines subcommand: "${action}"`);
    console.error("Run: collab pipelines --help");
    process.exit(1);
    return;
  }

  // ─── collab pipeline ──────────────────────────────────────────────────────
  if (subcommand === "pipeline") {
    const action = positional[0];

    if (!action || flags.help || flags.h) {
      console.log("Usage: collab pipeline <init|validate>");
      return;
    }

    if (action === "init") {
      const name = typeof flags.name === "string" ? flags.name : undefined;
      const type =
        typeof flags.type === "string" && (flags.type === "pipeline" || flags.type === "pack")
          ? (flags.type as "pipeline" | "pack")
          : undefined;
      const path =
        typeof flags.path === "string"
          ? flags.path
          : typeof flags.dir === "string"
          ? flags.dir
          : undefined;
      const result = await init({ name, type, path, force });
      if (!result.written && result.diff !== null) {
        console.log("pipeline.json already exists. Diff (existing → new):\n");
        console.log(result.diff);
        console.log("\nRe-run with --force to overwrite.");
      } else if (result.written) {
        console.log(`✓ Created ${path ?? "."}/pipeline.json`);
        if (result.warnings.length > 0) {
          for (const w of result.warnings) console.warn(`  ⚠  ${w}`);
        }
      }
      return;
    }

    if (action === "validate") {
      const path =
        typeof flags.path === "string" ? flags.path : positional[1];
      await validate({ path });
      return;
    }

    console.error(`Unknown pipeline subcommand: "${action}"`);
    console.error("Run: collab pipeline --help");
    process.exit(1);
    return;
  }

  console.error(`Unknown command: "${subcommand}"`);
  console.error("Run: collab --help");
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
