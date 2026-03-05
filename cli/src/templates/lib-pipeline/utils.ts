/**
 * Pipeline utilities — shared between orchestrator scripts.
 *
 * Pure functions for repo root detection, JSON file I/O, and registry paths.
 * No side effects - all I/O is explicit in the function signatures.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { emitStatusEvent } from "./status-emitter";

export function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}

export function readJsonFile(filePath: string): any | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function writeJsonAtomic(filePath: string, data: any): void {
  const previous = readJsonFile(filePath);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
  if (data && typeof data === "object" && data.ticket_id) {
    emitStatusEvent(filePath, previous, data);
  }
}

export function getRegistryPath(registryDir: string, ticketId: string): string {
  return path.join(registryDir, `${ticketId}.json`);
}

/**
 * Feature metadata as stored in specs/{feature}/metadata.json.
 * Key normalization: `pipeline` → `pipeline_variant` is handled by readFeatureMetadata.
 */
export interface FeatureMetadata {
  ticket_id: string;
  repo_id?: string;
  pipeline_variant?: string;
  worktree_path?: string;
  blockedBy?: string[];
  branch_name?: string;
  project_name?: string;
  service?: string;
  [key: string]: unknown;
}

function normalizeMetadata(raw: Record<string, unknown>): FeatureMetadata {
  const result = { ...raw } as FeatureMetadata;
  if (!result.pipeline_variant && typeof result.pipeline === "string") {
    result.pipeline_variant = result.pipeline;
  }
  return result;
}

/**
 * Read and parse metadata.json for a ticket from specs/.
 *
 * Uses a 2-pass scan:
 *   Pass 1: directory name contains ticketId (case-insensitive)
 *   Pass 2: scan all metadata.json files for ticket_id field match
 *
 * Normalizes `pipeline` key → `pipeline_variant` (single place for this fallback).
 * Returns null if not found or specsDir does not exist.
 */
export function readFeatureMetadata(specsDir: string, ticketId: string): FeatureMetadata | null {
  if (!fs.existsSync(specsDir)) return null;
  let entries: string[];
  try {
    entries = fs.readdirSync(specsDir);
  } catch {
    return null;
  }

  // Pass 1: dir name contains ticketId (case-insensitive)
  for (const entry of entries) {
    if (!entry.toLowerCase().includes(ticketId.toLowerCase())) continue;
    const raw = readJsonFile(path.join(specsDir, entry, "metadata.json")) as Record<string, unknown> | null;
    if (raw) return normalizeMetadata(raw);
  }

  // Pass 2: scan metadata.json files for ticket_id field match
  for (const entry of entries) {
    const raw = readJsonFile(path.join(specsDir, entry, "metadata.json")) as Record<string, unknown> | null;
    if (raw?.ticket_id === ticketId) return normalizeMetadata(raw);
  }

  return null;
}

/**
 * Read and normalize metadata.json from a specific feature directory path.
 * Use this when you already have the directory path.
 * Returns null if metadata.json does not exist or is malformed.
 */
export function readMetadataJson(featureDirPath: string): FeatureMetadata | null {
  const raw = readJsonFile(path.join(featureDirPath, "metadata.json")) as Record<string, unknown> | null;
  return raw ? normalizeMetadata(raw) : null;
}

/**
 * Read all metadata.json files from specs/ entries.
 * Returns an array of normalized FeatureMetadata objects.
 */
export function scanFeaturesMetadata(specsDir: string): FeatureMetadata[] {
  if (!fs.existsSync(specsDir)) return [];
  let entries: string[];
  try {
    entries = fs.readdirSync(specsDir);
  } catch {
    return [];
  }
  const results: FeatureMetadata[] = [];
  for (const entry of entries) {
    const raw = readJsonFile(path.join(specsDir, entry, "metadata.json")) as Record<string, unknown> | null;
    if (raw?.ticket_id) results.push(normalizeMetadata(raw));
  }
  return results;
}

/**
 * Scan specs/ for a directory whose name contains ticketId (case-insensitive).
 * Falls back to scanning metadata.json files for ticket_id match (Pass 2).
 * Returns the full path, or null if not found.
 */
export function findFeatureDir(repoRoot: string, ticketId: string): string | null {
  const specsDir = path.join(repoRoot, "specs");
  if (!fs.existsSync(specsDir)) return null;
  let entries: string[];
  try {
    entries = fs.readdirSync(specsDir);
  } catch {
    return null;
  }

  // Pass 1: dir name contains ticketId (case-insensitive)
  for (const entry of entries) {
    if (entry.toLowerCase().includes(ticketId.toLowerCase())) {
      return path.join(specsDir, entry);
    }
  }

  // Pass 2: metadata.json ticket_id match
  for (const entry of entries) {
    const raw = readJsonFile(path.join(specsDir, entry, "metadata.json")) as Record<string, unknown> | null;
    if (raw?.ticket_id === ticketId) return path.join(specsDir, entry);
  }

  return null;
}
