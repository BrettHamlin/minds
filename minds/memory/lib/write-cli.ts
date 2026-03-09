#!/usr/bin/env bun
/**
 * write-cli.ts — CLI wrapper for appending to a Mind's daily log.
 *
 * Usage:
 *   bun minds/memory/lib/write-cli.ts --mind <name> --content <text>
 *   bun minds/memory/lib/write-cli.ts --mind <name> --content-file <path>
 *   bun minds/memory/lib/write-cli.ts --mind <name> --content <text> --date 2026-03-08
 */

import { readFileSync, existsSync } from "fs";
import { appendDailyLog } from "./write.js";

interface ParsedArgs {
  mindName?: string;
  content?: string;
  contentFile?: string;
  date?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let mindName: string | undefined;
  let content: string | undefined;
  let contentFile: string | undefined;
  let date: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mind") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        console.error("write-cli: --mind requires a value");
        process.exit(1);
      }
      mindName = args[i + 1];
      i++;
    } else if (args[i] === "--content") {
      if (i + 1 >= args.length) {
        console.error("write-cli: --content requires a value");
        process.exit(1);
      }
      content = args[i + 1];
      i++;
    } else if (args[i] === "--content-file") {
      if (i + 1 >= args.length) {
        console.error("write-cli: --content-file requires a value");
        process.exit(1);
      }
      contentFile = args[i + 1];
      i++;
    } else if (args[i] === "--date") {
      if (i + 1 >= args.length) {
        console.error("write-cli: --date requires a value (YYYY-MM-DD)");
        process.exit(1);
      }
      const dateArg = args[i + 1];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
        console.error(`write-cli: --date must be in YYYY-MM-DD format, got "${dateArg}"`);
        process.exit(1);
      }
      date = dateArg;
      i++;
    } else if (args[i].startsWith("--")) {
      console.error(`write-cli: unknown flag "${args[i]}"`);
      process.exit(1);
    }
  }

  return { mindName, content, contentFile, date };
}

async function main(): Promise<void> {
  const { mindName, content, contentFile, date } = parseArgs(process.argv);

  if (!mindName) {
    console.error("write-cli: --mind <name> is required");
    process.exit(1);
  }

  if (content !== undefined && contentFile !== undefined) {
    console.error("write-cli: --content and --content-file are mutually exclusive");
    process.exit(1);
  }

  let finalContent: string;
  if (contentFile !== undefined) {
    if (!existsSync(contentFile)) {
      console.error(`write-cli: --content-file: file not found: ${contentFile}`);
      process.exit(1);
    }
    finalContent = readFileSync(contentFile, "utf-8");
  } else if (content !== undefined) {
    finalContent = content;
  } else {
    console.error("write-cli: --content <text> or --content-file <path> is required");
    process.exit(1);
  }

  await appendDailyLog(mindName, finalContent, date);

  const dateLabel = date ?? new Date().toISOString().slice(0, 10);
  console.log(`Appended to ${mindName} daily log (${dateLabel}).`);
}

main().catch((err: Error) => {
  console.error(`write-cli: ${err.message}`);
  process.exit(1);
});
