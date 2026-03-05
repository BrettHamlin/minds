#!/usr/bin/env bun

/**
 * write-resolutions.ts — Deterministic CLI for writing validated resolution files.
 *
 * Parses model inference output (JSON), validates the structure, and writes
 * the resolutions/{phase}-round-{N}.json file that the agent polls for.
 *
 * Usage:
 *   bun write-resolutions.ts <phase> <round> <resolutions-json-file>
 *   bun write-resolutions.ts <phase> <round> --stdin
 *   echo '<json>' | bun write-resolutions.ts <phase> <round> --stdin
 *
 * The resolutions JSON can be:
 *   - A ResolutionBatch object: { phase, round, resolutions: [...] }
 *   - An array of Resolution objects: [{ findingId, answer, reasoning, sources }]
 *
 * Output:
 *   Writes to specs/{feature}/resolutions/{phase}-round-{round}.json
 *   (feature directory resolved from the ticket_id in the context-bundle.json)
 *
 * Environment:
 *   TICKET_ID — required unless --feature-dir is supplied
 *   FEATURE_DIR — path to the feature directory (overrides TICKET_ID lookup)
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 *   2 = invalid or malformed input
 *   3 = unable to write output file
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

import type { Resolution, ResolutionBatch } from "../../../lib/pipeline/questions";
import { getResolutionsPath } from "../../../lib/pipeline/questions";
import { getRepoRoot, findFeatureDir } from "../../../lib/pipeline/utils";

// ── Validation ────────────────────────────────────────────────────────────────

function isResolution(obj: unknown): obj is Resolution {
  if (typeof obj !== "object" || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return (
    typeof r.findingId === "string" &&
    r.findingId.length > 0 &&
    typeof r.answer === "string" &&
    typeof r.reasoning === "string" &&
    Array.isArray(r.sources)
  );
}

function parseResolutionsInput(
  raw: string,
  phase: string,
  round: number,
): ResolutionBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e}`);
  }

  // Case 1: Already a ResolutionBatch
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "resolutions" in (parsed as object)
  ) {
    const batch = parsed as Record<string, unknown>;
    if (!Array.isArray(batch.resolutions)) {
      throw new Error("ResolutionBatch.resolutions must be an array");
    }
    const resolutions = batch.resolutions as unknown[];
    const invalid = resolutions.filter((r) => !isResolution(r));
    if (invalid.length > 0) {
      throw new Error(
        `Invalid Resolution objects at indices: ${
          resolutions.map((_, i) => (!isResolution(resolutions[i]) ? i : -1)).filter((i) => i >= 0).join(", ")
        }`,
      );
    }
    return {
      phase: (batch.phase as string) ?? phase,
      round: (batch.round as number) ?? round,
      resolutions: resolutions as Resolution[],
    };
  }

  // Case 2: Array of Resolution objects
  if (Array.isArray(parsed)) {
    const invalid = parsed.filter((r) => !isResolution(r));
    if (invalid.length > 0) {
      const badIndices = parsed
        .map((r, i) => (!isResolution(r) ? i : -1))
        .filter((i) => i >= 0);
      throw new Error(`Invalid Resolution objects at indices: ${badIndices.join(", ")}`);
    }
    return {
      phase,
      round,
      resolutions: parsed as Resolution[],
    };
  }

  throw new Error(
    "Input must be a ResolutionBatch object or array of Resolution objects",
  );
}

// ── Feature dir resolution ────────────────────────────────────────────────────

function resolveFeatureDir(ticketId?: string, featureDirEnv?: string): string {
  if (featureDirEnv && existsSync(featureDirEnv)) return featureDirEnv;
  if (!ticketId) {
    throw new Error(
      "TICKET_ID environment variable or --feature-dir is required",
    );
  }
  const repoRoot = getRepoRoot();
  const featureDir = findFeatureDir(repoRoot, ticketId);
  if (!featureDir) {
    throw new Error(`Could not find feature directory for ticket ${ticketId}`);
  }
  return featureDir;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error(
      "Usage: write-resolutions.ts <phase> <round> <resolutions-json-file>",
    );
    console.error("       write-resolutions.ts <phase> <round> --stdin");
    console.error("");
    console.error("Environment: TICKET_ID or FEATURE_DIR must be set");
    process.exit(1);
  }

  const phase = args[0];
  const round = parseInt(args[1], 10);
  if (isNaN(round) || round < 1) {
    console.error(`Error: round must be a positive integer, got: ${args[1]}`);
    process.exit(1);
  }

  const inputArg = args[2];
  let featureDirOverride: string | undefined;
  for (let i = 3; i < args.length; i++) {
    if (args[i] === "--feature-dir" && args[i + 1]) {
      featureDirOverride = args[++i];
    }
  }

  let rawInput: string;
  if (inputArg === "--stdin") {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    rawInput = Buffer.concat(chunks).toString("utf-8");
  } else {
    if (!existsSync(inputArg)) {
      console.error(`Error: input file not found: ${inputArg}`);
      process.exit(2);
    }
    rawInput = readFileSync(inputArg, "utf-8");
  }

  let batch: ResolutionBatch;
  try {
    batch = parseResolutionsInput(rawInput, phase, round);
  } catch (e) {
    console.error(`Error: ${e}`);
    process.exit(2);
  }

  // Resolve feature directory
  const ticketId = process.env.TICKET_ID;
  const featureDirEnv = process.env.FEATURE_DIR;
  let featureDir: string;
  try {
    featureDir = resolveFeatureDir(ticketId, featureDirOverride ?? featureDirEnv);
  } catch (e) {
    console.error(`Error: ${e}`);
    process.exit(3);
  }

  const outPath = getResolutionsPath(featureDir, phase, round);
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(batch, null, 2));
  } catch (e) {
    console.error(`Error writing resolutions: ${e}`);
    process.exit(3);
  }

  console.log(
    `[write-resolutions] Written ${batch.resolutions.length} resolution(s) to: ${outPath}`,
  );
}

if (import.meta.main) {
  main();
}

export { parseResolutionsInput };
