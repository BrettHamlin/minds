// smoke-marker.ts — CLI utility that shells out to smoke-probe and writes result JSON (BRE-454 T005)
//
// Usage: bun minds/transport/smoke-marker.ts [--out <path>]
//
// Shells out to:
//   bun minds/dashboard/smoke-probe.ts --phase transport --ticket BRE-454 --dry-run
//
// Writes result to minds/transport/smoke-result.json (or --out path):
//   { phase, ticket, timestamp, status }

import { writeFileSync } from "fs";
import { join } from "path";

export interface SmokeResult {
  phase: string;
  ticket: string;
  timestamp: string;
  status: "complete" | "failed";
}

/**
 * Run the smoke-probe CLI and write the result JSON to the given output path.
 */
export async function runSmokeMarker(outputPath: string): Promise<SmokeResult> {
  const phase = "transport";
  const ticket = "BRE-454";

  const proc = Bun.spawn(
    ["bun", "minds/dashboard/smoke-probe.ts", "--phase", phase, "--ticket", ticket, "--dry-run"],
    { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
  );

  await proc.exited;
  const exitCode = proc.exitCode;

  const result: SmokeResult = {
    phase,
    ticket,
    timestamp: new Date().toISOString(),
    status: exitCode === 0 ? "complete" : "failed",
  };

  writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outputPath =
    outIdx !== -1 && args[outIdx + 1]
      ? args[outIdx + 1]
      : join(process.cwd(), "minds/transport/smoke-result.json");

  try {
    const result = await runSmokeMarker(outputPath);
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(1);
  }
}
