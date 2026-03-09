#!/usr/bin/env bun
/**
 * provision-cli.ts — CLI wrapper for memory provisioning.
 *
 * Usage:
 *   bun minds/memory/lib/provision-cli.ts              # provision all Minds
 *   bun minds/memory/lib/provision-cli.ts --mind <name> # provision one Mind
 */

import { provisionMind, provisionAllMinds } from "./provision.js";

function parseArgs(argv: string[]): { mindName?: string } {
  const args = argv.slice(2); // strip bun + script path
  let mindName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mind") {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        console.error("provision-cli: --mind requires a value (e.g. --mind pipeline_core)");
        process.exit(1);
      }
      mindName = args[i + 1];
      i++;
    } else if (args[i].startsWith("--")) {
      console.error(`provision-cli: unknown flag "${args[i]}"`);
      process.exit(1);
    }
  }

  return { mindName };
}

async function main(): Promise<void> {
  const { mindName } = parseArgs(process.argv);

  if (mindName) {
    const result = await provisionMind(mindName);
    if (result.status === "created") {
      console.log(`Provisioned: ${result.mindName} → ${result.memoryDir}`);
    } else {
      console.log(`Already provisioned: ${result.mindName} (${result.memoryDir})`);
    }
  } else {
    const result = await provisionAllMinds();
    for (const r of result.provisioned) {
      if (r.status === "created") {
        console.log(`Provisioned: ${r.mindName} → ${r.memoryDir}`);
      } else {
        console.log(`Already provisioned: ${r.mindName}`);
      }
    }
    console.log(
      `Done: ${result.provisioned.filter((r) => r.status === "created").length} created, ` +
        `${result.provisioned.filter((r) => r.status === "already_exists").length} already existed, ` +
        `${result.skipped.length} skipped.`
    );
  }
}

main().catch((err: Error) => {
  console.error(`provision-cli: ${err.message}`);
  process.exit(1);
});
