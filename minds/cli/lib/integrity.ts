/**
 * Collab CLI — SHA-256 checksum generation + verification
 * Uses Node.js built-in crypto module. Zero external deps.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { makeError } from "../types/index.js";
import type { CollabError } from "../types/index.js";

/**
 * Compute SHA-256 checksum of a Buffer or string.
 * Returns hex-encoded digest.
 */
export function computeChecksum(data: Buffer | string): string {
  const hash = createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

/**
 * Compute SHA-256 checksum of a file on disk.
 * Throws CollabError if file cannot be read.
 */
export function checksumFile(filePath: string): string {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch (err) {
    throw makeError(
      "CHECKSUM_MISMATCH",
      `Cannot read file for checksum: ${filePath}`,
      { path: filePath, cause: String(err) }
    );
  }
  return computeChecksum(data);
}

/**
 * Verify that data matches an expected checksum.
 * Throws CollabError if checksums do not match (signals corrupt download).
 *
 * @param data      The downloaded content
 * @param expected  The expected SHA-256 hex string from the registry/lockfile
 * @param name      Pipeline name (for error context)
 */
export function verifyChecksum(
  data: Buffer | string,
  expected: string,
  name: string
): void {
  const actual = computeChecksum(data);
  if (!timingSafeEqual(actual, expected)) {
    throw makeError(
      "CHECKSUM_MISMATCH",
      `Checksum mismatch for "${name}": expected ${expected}, got ${actual}`,
      { name, expected, actual }
    );
  }
}

/**
 * Verify a file on disk matches an expected checksum.
 * Throws CollabError if the file cannot be read or checksums don't match.
 */
export function verifyFileChecksum(
  filePath: string,
  expected: string,
  name: string
): void {
  let data: Buffer;
  try {
    data = readFileSync(filePath);
  } catch (err) {
    throw makeError(
      "CHECKSUM_MISMATCH",
      `Cannot read file for verification: ${filePath}`,
      { path: filePath, name, cause: String(err) }
    );
  }
  verifyChecksum(data, expected, name);
}

/**
 * Generate a checksum record for multiple named buffers.
 * Returns a Map of name → sha256 hex.
 */
export function checksumMap(
  entries: Array<{ name: string; data: Buffer | string }>
): Map<string, string> {
  const result = new Map<string, string>();
  for (const { name, data } of entries) {
    result.set(name, computeChecksum(data));
  }
  return result;
}

// ─── Directory checksums ──────────────────────────────────────────────────────

/**
 * Generate a deterministic SHA-256 checksum of a pipeline directory.
 *
 * Hashes ALL files recursively, sorted alphabetically by relative path.
 * Sort order is enforced (not relying on OS directory enumeration) so
 * the result is identical across macOS, Linux, and Windows.
 *
 * Empty directory returns a stable hash of an empty byte sequence.
 */
export function generateChecksum(dir: string): string {
  const files = getFilesRecursive(dir);
  const hash = createHash("sha256");
  for (const relPath of files) {
    // Include the relative path in the hash so renames change the checksum
    hash.update(relPath);
    hash.update(readFileSync(join(dir, relPath)));
  }
  return hash.digest("hex");
}

/**
 * Verify the checksum of a pipeline directory against an expected hash.
 * Returns `{ valid: true }` on match, `{ valid: false, actual }` on mismatch.
 * Never throws — caller decides how to handle a mismatch.
 */
export function verifyDirectoryChecksum(
  dir: string,
  expected: string
): { valid: boolean; actual: string } {
  const actual = generateChecksum(dir);
  return { valid: actual === expected, actual };
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Recursively list all files under `dir`, returning relative paths sorted
 * alphabetically.  Directories are not included in the output.
 */
function getFilesRecursive(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return; // unreadable directory — treat as empty
    }
    for (const entry of entries) {
      const fullPath = join(current, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else {
        results.push(relative(dir, fullPath));
      }
    }
  }

  walk(dir);
  results.sort(); // deterministic order across all OSes
  return results;
}

/**
 * Constant-time string comparison to prevent timing attacks on checksum verification.
 * Pads or truncates to equal length before comparing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Ensure both are same length by using fixed-length comparison
  // For hex SHA-256 strings this is always 64 chars, but be defensive
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
