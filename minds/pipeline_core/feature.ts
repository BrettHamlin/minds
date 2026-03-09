/**
 * feature.ts — Feature directory and metadata operations.
 */

import * as fs from "fs";
import * as path from "path";
import { readJsonFile } from "./json-io";

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

export function normalizeMetadata(raw: Record<string, unknown>): FeatureMetadata {
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
 * Use this when you already have the directory path (e.g., from findSpecDir).
 * Returns null if metadata.json does not exist or is malformed.
 */
export function readMetadataJson(featureDirPath: string): FeatureMetadata | null {
  const raw = readJsonFile(path.join(featureDirPath, "metadata.json")) as Record<string, unknown> | null;
  return raw ? normalizeMetadata(raw) : null;
}

/**
 * Read all metadata.json files from specs/ entries.
 * Returns an array of normalized FeatureMetadata objects (entries without metadata.json are skipped).
 * Centralizes the "scan all features" use case.
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
 * Scan specs/ for a feature directory, using a 4-pass resolution strategy.
 *
 * Resolution order:
 *   Pass 0a: exact branch match — specs/{branch}
 *   Pass 0b: branch numeric prefix match — specs/{NNN}-*
 *   Pass 1:  dir name contains ticketId (case-insensitive)
 *   Pass 2:  metadata.json ticket_id field match
 *
 * @param repoRoot  - Repository root directory.
 * @param ticketId  - Ticket ID or numeric prefix (e.g. "BRE-423" or "001").
 * @param options.branch - Git branch name; enables Passes 0a and 0b.
 * @returns Full path to the feature directory, or null if not found.
 */
export function findFeatureDir(
  repoRoot: string,
  ticketId: string,
  options?: { branch?: string }
): string | null {
  const specsDir = path.join(repoRoot, "specs");
  if (!fs.existsSync(specsDir)) return null;
  let entries: string[];
  try {
    entries = fs.readdirSync(specsDir);
  } catch {
    return null;
  }

  const branch = options?.branch;

  // Pass 0a: exact branch match — specs/{branch}
  if (branch) {
    const exactPath = path.join(specsDir, branch);
    if (fs.existsSync(exactPath)) return exactPath;
  }

  // Pass 0b: branch numeric prefix match — first entry starting with NNN-
  if (branch) {
    const prefixMatch = branch.match(/^(\d{3})-/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      for (const entry of entries) {
        if (entry.startsWith(`${prefix}-`)) {
          return path.join(specsDir, entry);
        }
      }
    }
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
