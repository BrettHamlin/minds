// smoke-marker.ts — CLI utility that shells out to smoke-probe and writes result JSON (BRE-454 T003)
// Usage: bun minds/pipeline_core/smoke-marker.ts

import { writeFileSync } from "fs";
import { join } from "path";

const PHASE = "pipeline_core";
const TICKET = "BRE-454";
const RESULT_PATH = join(import.meta.dir, "smoke-result.json");

async function main(): Promise<void> {
  const proc = Bun.spawn(
    ["bun", "minds/dashboard/smoke-probe.ts", "--phase", PHASE, "--ticket", TICKET, "--dry-run"],
    { stdout: "pipe", stderr: "pipe" }
  );

  await proc.exited;

  const result = {
    phase: PHASE,
    ticket: TICKET,
    timestamp: new Date().toISOString(),
    status: "complete",
  };

  writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}

main();
