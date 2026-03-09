#!/usr/bin/env bun
/**
 * search-cli.ts — CLI wrapper for memory search.
 *
 * Usage:
 *   bun minds/memory/lib/search-cli.ts --mind <name> --query <text>
 *   bun minds/memory/lib/search-cli.ts --mind <name> --query <text> --max 5
 */

import { searchMemory } from "./search.js";

interface ParsedArgs {
  mindName?: string;
  query?: string;
  maxResults?: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let mindName: string | undefined;
  let query: string | undefined;
  let maxResults: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mind") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        console.error("search-cli: --mind requires a value");
        process.exit(1);
      }
      mindName = args[i + 1];
      i++;
    } else if (args[i] === "--query") {
      if (i + 1 >= args.length) {
        console.error("search-cli: --query requires a value");
        process.exit(1);
      }
      query = args[i + 1];
      i++;
    } else if (args[i] === "--max") {
      if (i + 1 >= args.length) {
        console.error("search-cli: --max requires a numeric value");
        process.exit(1);
      }
      const parsed = parseInt(args[i + 1], 10);
      if (isNaN(parsed) || parsed < 1) {
        console.error(`search-cli: --max must be a positive integer, got "${args[i + 1]}"`);
        process.exit(1);
      }
      maxResults = parsed;
      i++;
    } else if (args[i].startsWith("--")) {
      console.error(`search-cli: unknown flag "${args[i]}"`);
      process.exit(1);
    }
  }

  return { mindName, query, maxResults };
}

async function main(): Promise<void> {
  const { mindName, query, maxResults } = parseArgs(process.argv);

  if (!mindName) {
    console.error("search-cli: --mind <name> is required");
    process.exit(1);
  }
  if (!query) {
    console.error("search-cli: --query <text> is required");
    process.exit(1);
  }

  const results = await searchMemory(mindName, query, { maxResults });

  if (results.length === 0) {
    console.log(`No results for "${query}" in mind "${mindName}".`);
    return;
  }

  for (const r of results) {
    console.log(`\n--- ${r.path} (lines ${r.startLine}–${r.endLine}) [score: ${r.score.toFixed(4)}] ---`);
    console.log(r.content);
  }
}

main().catch((err: Error) => {
  console.error(`search-cli: ${err.message}`);
  process.exit(1);
});
