#!/usr/bin/env bun
/**
 * scaffold-from-naming.ts — Takes naming JSON (from Claude Code) and scaffolds Minds.
 *
 * Usage:
 *   bun minds/fission/scaffold-from-naming.ts <naming-json-path>
 *
 * The naming JSON is an array of objects:
 *   [{ clusterId, name, domain, keywords, exposes, consumes }]
 *
 * This script:
 * 1. Reads the naming JSON
 * 2. Validates names
 * 3. Scaffolds each Mind directory (MIND.md + server.ts)
 * 4. Updates minds.json registry
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { mindsRoot } from "../shared/paths.js";
import { scaffoldMind, validateMindName, mindsJsonPath } from "../instantiate/lib/scaffold.js";
import { generateOwnsPatterns } from "./naming/naming.js";

interface NamingEntry {
  clusterId: number;
  name: string;
  domain: string;
  keywords?: string[];
  exposes?: string[];
  consumes?: string[];
  owns_files?: string[];
}

interface PipelineCluster {
  clusterId: number;
  files: string[];
}

// Parse args
const namingPath = process.argv[2];
const targetDir = process.argv[3]; // optional, used for pipeline JSON lookup
if (!namingPath) {
  console.error("Usage: bun scaffold-from-naming.ts <naming-json-path> [target-dir]");
  process.exit(1);
}

// Read naming JSON
const namingRaw = readFileSync(resolve(namingPath), "utf8");
let entries: NamingEntry[];
try {
  entries = JSON.parse(namingRaw);
  if (!Array.isArray(entries)) throw new Error("Expected JSON array");
} catch (err) {
  console.error(`Failed to parse naming JSON: ${(err as Error).message}`);
  process.exit(1);
}

// Try to read pipeline JSON for cluster file lists (to compute owns_files).
// Checks: (1) explicit FISSION_PIPELINE_JSON env var, (2) /tmp/fission-pipeline.json convention
let pipelineClusters: PipelineCluster[] | undefined;
const pipelinePaths = [
  process.env.FISSION_PIPELINE_JSON,
  "/tmp/fission-pipeline.json",
].filter(Boolean) as string[];
for (const pp of pipelinePaths) {
  try {
    const pipelineRaw = readFileSync(resolve(pp), "utf8");
    const pipeline = JSON.parse(pipelineRaw);
    if (pipeline.clusters && Array.isArray(pipeline.clusters)) {
      pipelineClusters = pipeline.clusters;
      break;
    }
  } catch {
    // Try next path
  }
}

// Enrich entries with owns_files from pipeline cluster files when not provided
if (pipelineClusters) {
  const clusterMap = new Map(pipelineClusters.map((c) => [c.clusterId, c]));
  for (const entry of entries) {
    if (!entry.owns_files?.length) {
      const cluster = clusterMap.get(entry.clusterId);
      if (cluster?.files?.length) {
        entry.owns_files = generateOwnsPatterns(cluster.files);
      }
    }
  }
}

// Validate all names first
const errors: string[] = [];
for (const entry of entries) {
  const nameErr = validateMindName(entry.name);
  if (nameErr) errors.push(`Cluster ${entry.clusterId} ("${entry.name}"): ${nameErr}`);
  if (!entry.domain?.trim()) errors.push(`Cluster ${entry.clusterId}: domain is required`);
}

if (errors.length > 0) {
  console.error("Validation errors:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// Use canonical path resolution
const mindsDir = mindsRoot();
const jsonPath = mindsJsonPath();

console.log(`Scaffolding ${entries.length} Minds into ${mindsDir}/`);

const created: string[] = [];
const skipped: string[] = [];
const failed: { name: string; error: string }[] = [];

for (const entry of entries) {
  try {
    await scaffoldMind(entry.name, entry.domain, {
      mindsSrcDir: mindsDir,
      mindsJsonOverride: jsonPath,
      ownsFiles: entry.owns_files,
    });
    created.push(entry.name);
    console.log(`  + ${entry.name}: ${entry.domain}`);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("already exists")) {
      skipped.push(entry.name);
      console.log(`  = ${entry.name}: already exists, skipped`);
    } else {
      failed.push({ name: entry.name, error: msg });
      console.error(`  x ${entry.name}: ${msg}`);
    }
  }
}

// Also scaffold foundation if not exists
try {
  await scaffoldMind("foundation", "Shared foundation layer providing cross-cutting utilities to all Minds.", {
    mindsSrcDir: mindsDir,
    mindsJsonOverride: jsonPath,
  });
  created.push("foundation");
  console.log(`  + foundation: shared foundation layer`);
} catch (err) {
  const msg = (err as Error).message;
  if (msg.includes("already exists")) {
    skipped.push("foundation");
  } else {
    failed.push({ name: "foundation", error: msg });
  }
}

console.log(`\nDone: ${created.length} created, ${skipped.length} skipped, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);
