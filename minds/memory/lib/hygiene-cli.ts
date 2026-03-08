#!/usr/bin/env bun
/**
 * hygiene-cli.ts — CLI wrapper for memory hygiene operations.
 *
 * Usage:
 *   bun minds/memory/lib/hygiene-cli.ts --mind <name> --promote "entry1" --promote "entry2"
 *   bun minds/memory/lib/hygiene-cli.ts --mind <name> --prune
 *   bun minds/memory/lib/hygiene-cli.ts --mind <name> --promote "entry" --prune
 */

import { promoteToMemoryMd, pruneStaleEntries } from "./hygiene.js";

interface ParsedArgs {
  mindName?: string;
  entries: string[];
  prune: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let mindName: string | undefined;
  const entries: string[] = [];
  let prune = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mind") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        console.error("hygiene-cli: --mind requires a value (e.g. --mind pipeline_core)");
        process.exit(1);
      }
      mindName = args[i + 1];
      i++;
    } else if (args[i] === "--promote") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        console.error("hygiene-cli: --promote requires a value (e.g. --promote \"some insight\")");
        process.exit(1);
      }
      entries.push(args[i + 1]);
      i++;
    } else if (args[i] === "--prune") {
      prune = true;
    } else if (args[i].startsWith("--")) {
      console.error(`hygiene-cli: unknown flag "${args[i]}"`);
      process.exit(1);
    }
  }

  return { mindName, entries, prune };
}

async function main(): Promise<void> {
  const { mindName, entries, prune } = parseArgs(process.argv);

  if (!mindName) {
    console.error("hygiene-cli: --mind <name> is required");
    process.exit(1);
  }

  if (entries.length === 0 && !prune) {
    console.error("hygiene-cli: at least one of --promote <entry> or --prune is required");
    process.exit(1);
  }

  if (entries.length > 0) {
    await promoteToMemoryMd(mindName, entries);
    console.log(`Promoted ${entries.length} entr${entries.length === 1 ? "y" : "ies"} to ${mindName} MEMORY.md`);
  }

  if (prune) {
    await pruneStaleEntries(mindName);
    console.log(`Pruned stale entries from ${mindName} MEMORY.md`);
  }
}

main().catch((err: Error) => {
  console.error(`hygiene-cli: ${err.message}`);
  process.exit(1);
});
