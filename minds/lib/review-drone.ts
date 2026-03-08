#!/usr/bin/env bun
/**
 * review-drone.ts — Publish deterministic review lifecycle events to the Minds bus.
 *
 * Programmatic usage:
 *   import { startReview, reviewPass, reviewFail } from "./review-drone.ts";
 *
 * CLI usage:
 *   bun minds/lib/review-drone.ts start-review --bus-url $BUS_URL --channel minds-{ticketId} --wave-id {waveId} --mind {mindName}
 *   bun minds/lib/review-drone.ts review-pass --bus-url $BUS_URL --channel minds-{ticketId} --wave-id {waveId} --mind {mindName}
 *   bun minds/lib/review-drone.ts review-fail --bus-url $BUS_URL --channel minds-{ticketId} --wave-id {waveId} --mind {mindName} [--violations {count}]
 */

import { mindsPublish } from "../transport/minds-publish.ts";

// ─── Programmatic API ─────────────────────────────────────────────────────────

/**
 * Publish DRONE_REVIEWING when the Mind begins reviewing a drone's output.
 * Non-critical — bus failure must never block the pipeline.
 */
export async function startReview(
  busUrl: string,
  channel: string,
  waveId: string,
  mindName: string,
): Promise<void> {
  await mindsPublish(busUrl, channel, "DRONE_REVIEWING", { waveId, mindName }).catch(() => {});
}

/**
 * Publish DRONE_REVIEW_PASS when the Mind approves a drone's output.
 * Non-critical — bus failure must never block the pipeline.
 */
export async function reviewPass(
  busUrl: string,
  channel: string,
  waveId: string,
  mindName: string,
): Promise<void> {
  await mindsPublish(busUrl, channel, "DRONE_REVIEW_PASS", { waveId, mindName }).catch(() => {});
}

/**
 * Publish DRONE_REVIEW_FAIL when the Mind finds violations in a drone's output.
 * Non-critical — bus failure must never block the pipeline.
 */
export async function reviewFail(
  busUrl: string,
  channel: string,
  waveId: string,
  mindName: string,
  violations?: number,
): Promise<void> {
  await mindsPublish(busUrl, channel, "DRONE_REVIEW_FAIL", { waveId, mindName, violations }).catch(() => {});
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  function getArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  }

  const busUrl = getArg("--bus-url");
  const channel = getArg("--channel");
  const waveId = getArg("--wave-id");
  const mindName = getArg("--mind");

  if (!busUrl || !channel || !waveId || !mindName || !command) {
    console.error(
      "Usage: review-drone.ts <start-review|review-pass|review-fail> " +
        "--bus-url <url> --channel <channel> --wave-id <id> --mind <name> [--violations <count>]",
    );
    process.exit(1);
  }

  switch (command) {
    case "start-review":
      await startReview(busUrl, channel, waveId, mindName);
      break;
    case "review-pass":
      await reviewPass(busUrl, channel, waveId, mindName);
      break;
    case "review-fail": {
      const violationsStr = getArg("--violations");
      const violations = violationsStr !== undefined ? parseInt(violationsStr, 10) : undefined;
      await reviewFail(busUrl, channel, waveId, mindName, violations);
      break;
    }
    default:
      console.error(`Unknown command: "${command}". Expected: start-review, review-pass, review-fail`);
      process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, command, mindName }));
}
