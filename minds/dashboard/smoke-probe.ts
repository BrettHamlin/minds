// smoke-probe.ts — CLI utility for dashboard phase smoke testing (BRE-454 T001)
// Usage: bun minds/dashboard/smoke-probe.ts --phase <name> --ticket <id> [--dry-run]

const args = process.argv.slice(2);

function parseArgs(argv: string[]): {
  phase: string | null;
  ticket: string | null;
  dryRun: boolean;
} {
  let phase: string | null = null;
  let ticket: string | null = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--phase" && i + 1 < argv.length) {
      phase = argv[++i];
    } else if (argv[i] === "--ticket" && i + 1 < argv.length) {
      ticket = argv[++i];
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { phase, ticket, dryRun };
}

function timestamp(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const { phase, ticket, dryRun } = parseArgs(args);

  if (!phase) {
    console.error("Error: --phase <name> is required");
    process.exit(1);
  }

  if (!ticket) {
    console.error("Error: --ticket <id> is required");
    process.exit(1);
  }

  console.log(`[${timestamp()}] Phase "${phase}" started for ${ticket}`);

  if (!dryRun) {
    await Bun.sleep(60_000);
  }

  console.log(`[${timestamp()}] Phase "${phase}" complete for ${ticket}`);
  process.exit(0);
}

main();
