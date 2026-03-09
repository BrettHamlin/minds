// smoke-marker.ts — shells out to smoke-probe CLI and writes result JSON (BRE-454 T004)
// Usage: bun minds/signals/smoke-marker.ts

import { join } from "path";

const REPO_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const SMOKE_PROBE = join(REPO_ROOT, "minds/dashboard/smoke-probe.ts");
const RESULT_PATH = join(REPO_ROOT, "minds/signals/smoke-result.json");

export interface SmokeResult {
  phase: string;
  ticket: string;
  timestamp: string;
  status: "complete" | "failed";
}

export async function runSmokeMarker(
  phase: string,
  ticket: string,
  resultPath: string = RESULT_PATH
): Promise<SmokeResult> {
  const proc = Bun.spawn(
    ["bun", SMOKE_PROBE, "--phase", phase, "--ticket", ticket, "--dry-run"],
    { stdout: "pipe", stderr: "pipe" }
  );

  await proc.exited;

  const status = proc.exitCode === 0 ? "complete" : "failed";

  const result: SmokeResult = {
    phase,
    ticket,
    timestamp: new Date().toISOString(),
    status,
  };

  await Bun.write(resultPath, JSON.stringify(result, null, 2) + "\n");

  return result;
}

async function main(): Promise<void> {
  const result = await runSmokeMarker("signals", "BRE-454");
  console.log(`smoke-marker: phase=${result.phase} ticket=${result.ticket} status=${result.status}`);
}

main();
