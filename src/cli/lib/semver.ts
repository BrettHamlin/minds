/**
 * Collab CLI — semver parsing + range evaluation
 * Zero external npm dependencies. Implements the subset of semver used by collab:
 * - Parse: "1.2.3", "1.2.3-alpha.1", "1.2.3+build"
 * - Ranges: "1.2.3" (exact), ">=1.2.3", ">1.2.3", "<=1.2.3", "<1.2.3",
 *           "^1.2.3" (compatible), "~1.2.3" (patch), "*" / "" (any)
 */

import { makeError } from "../types/index.js";
import type { CollabError } from "../types/index.js";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  buildmetadata: string[];
  raw: string;
}

/**
 * Parse a semver string. Returns a SemVer object or throws a CollabError.
 */
export function parse(version: string): SemVer {
  const raw = version.trim();
  // Strip leading "v" prefix (v1.2.3 → 1.2.3)
  const stripped = raw.startsWith("v") ? raw.slice(1) : raw;

  // Split on "+" for build metadata first
  const [mainPlusPre, ...buildParts] = stripped.split("+");
  const buildmetadata = buildParts.length > 0 ? buildParts.join("+").split(".") : [];

  // Split on "-" for pre-release
  const [mainStr, ...preParts] = mainPlusPre.split("-");
  const prerelease = preParts.length > 0 ? preParts.join("-").split(".") : [];

  // Parse X.Y.Z
  const parts = mainStr.split(".");
  if (parts.length !== 3) {
    throw makeError("SEMVER_PARSE_ERROR", `Invalid semver: "${version}"`, { version });
  }

  const [majorStr, minorStr, patchStr] = parts;
  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  const patch = parseInt(patchStr, 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    throw makeError("SEMVER_PARSE_ERROR", `Invalid semver: "${version}"`, { version });
  }
  if (major < 0 || minor < 0 || patch < 0) {
    throw makeError("SEMVER_PARSE_ERROR", `Negative version component: "${version}"`, { version });
  }

  return { major, minor, patch, prerelease, buildmetadata, raw };
}

/**
 * Try to parse a semver string. Returns null on failure instead of throwing.
 */
export function tryParse(version: string): SemVer | null {
  try {
    return parse(version);
  } catch {
    return null;
  }
}

/**
 * Normalize a version-like string from a range bound, allowing X.Y shorthand.
 * "1.6" → "1.6.0", "1.6.3" → "1.6.3"
 */
function normalizeRangeBound(version: string): string {
  const stripped = version.trim().replace(/^v/, "");
  // Strip pre-release/build before counting parts
  const mainPart = stripped.split("+")[0].split("-")[0];
  const parts = mainPart.split(".");
  if (parts.length === 2) return `${stripped}.0`;
  if (parts.length === 1 && /^\d+$/.test(parts[0])) return `${stripped}.0.0`;
  return stripped;
}

/**
 * Compare two SemVer values. Returns:
 *  -1 if a < b
 *   0 if a == b
 *   1 if a > b
 *
 * Follows semver 2.0.0 precedence rules:
 * - Compare major, minor, patch numerically
 * - Pre-release has lower precedence than release (1.0.0-alpha < 1.0.0)
 * - Pre-release fields compared left to right:
 *   numeric fields compared as integers, alphanumeric compared as strings
 * - Build metadata is ignored for precedence
 */
export function compare(a: SemVer, b: SemVer): -1 | 0 | 1 {
  // Major
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  // Minor
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  // Patch
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  // Pre-release comparison
  const aHasPre = a.prerelease.length > 0;
  const bHasPre = b.prerelease.length > 0;

  // No pre-release beats pre-release at same version
  if (!aHasPre && bHasPre) return 1;
  if (aHasPre && !bHasPre) return -1;

  // Both have pre-release — compare field by field
  const maxLen = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < maxLen; i++) {
    const af = a.prerelease[i];
    const bf = b.prerelease[i];

    // Shorter pre-release has lower precedence
    if (af === undefined) return -1;
    if (bf === undefined) return 1;

    const aNum = parseInt(af, 10);
    const bNum = parseInt(bf, 10);
    const aIsNum = !isNaN(aNum) && String(aNum) === af;
    const bIsNum = !isNaN(bNum) && String(bNum) === bf;

    if (aIsNum && bIsNum) {
      if (aNum !== bNum) return aNum > bNum ? 1 : -1;
    } else if (aIsNum) {
      // Numeric has lower precedence than alphanumeric
      return -1;
    } else if (bIsNum) {
      return 1;
    } else {
      // Both alphanumeric — compare as strings
      if (af !== bf) return af > bf ? 1 : -1;
    }
  }

  return 0;
}

/**
 * Compare version strings directly.
 */
export function compareStr(a: string, b: string): -1 | 0 | 1 {
  return compare(parse(a), parse(b));
}

/**
 * Returns true if version satisfies the given range.
 *
 * Supported range formats:
 *  "*" | ""        — any version
 *  "1.2.3"         — exact match (including prerelease)
 *  "=1.2.3"        — explicit exact match
 *  ">=1.2.3"       — greater than or equal
 *  ">1.2.3"        — strictly greater than
 *  "<=1.2.3"       — less than or equal
 *  "<1.2.3"        — strictly less than
 *  "^1.2.3"        — compatible: >=1.2.3 <2.0.0 (^0.x.y: >=0.x.y <0.(x+1).0)
 *  "~1.2.3"        — patch-level: >=1.2.3 <1.3.0
 *  "1.2.x" / "1.x" — wildcard (treated as ^ / * in minor)
 */
export function satisfies(version: string, range: string): boolean {
  const trimmed = range.trim();

  // Wildcard
  if (trimmed === "*" || trimmed === "") return true;

  const ver = tryParse(version);
  if (!ver) return false;

  // Caret range: ^1.2.3
  if (trimmed.startsWith("^")) {
    return satisfiesCaret(ver, trimmed.slice(1));
  }
  // Tilde range: ~1.2.3
  if (trimmed.startsWith("~")) {
    return satisfiesTilde(ver, trimmed.slice(1));
  }
  // >= <=
  if (trimmed.startsWith(">=")) {
    const bound = tryParse(normalizeRangeBound(trimmed.slice(2)));
    if (!bound) return false;
    return compare(ver, bound) >= 0;
  }
  if (trimmed.startsWith("<=")) {
    const bound = tryParse(normalizeRangeBound(trimmed.slice(2)));
    if (!bound) return false;
    return compare(ver, bound) <= 0;
  }
  // > <
  if (trimmed.startsWith(">")) {
    const bound = tryParse(normalizeRangeBound(trimmed.slice(1)));
    if (!bound) return false;
    return compare(ver, bound) > 0;
  }
  if (trimmed.startsWith("<")) {
    const bound = tryParse(normalizeRangeBound(trimmed.slice(1)));
    if (!bound) return false;
    return compare(ver, bound) < 0;
  }
  // Explicit = or bare version
  const bare = trimmed.startsWith("=") ? trimmed.slice(1) : trimmed;
  const exact = tryParse(normalizeRangeBound(bare));
  if (!exact) return false;
  return compare(ver, exact) === 0;
}

function satisfiesCaret(ver: SemVer, rangeStr: string): boolean {
  const lower = tryParse(normalizeRangeBound(rangeStr));
  if (!lower) return false;
  if (compare(ver, lower) < 0) return false;

  // Upper bound: increment first non-zero component
  if (lower.major !== 0) {
    // ^1.2.3 → <2.0.0
    return ver.major === lower.major;
  }
  if (lower.minor !== 0) {
    // ^0.2.3 → <0.3.0
    return ver.major === 0 && ver.minor === lower.minor;
  }
  // ^0.0.3 → <0.0.4
  return ver.major === 0 && ver.minor === 0 && ver.patch === lower.patch;
}

function satisfiesTilde(ver: SemVer, rangeStr: string): boolean {
  const lower = tryParse(normalizeRangeBound(rangeStr));
  if (!lower) return false;
  if (compare(ver, lower) < 0) return false;
  // ~1.2.3 → >=1.2.3 <1.3.0
  return ver.major === lower.major && ver.minor === lower.minor;
}

/**
 * Return the maximum version string from an array.
 * Returns undefined for empty arrays.
 */
export function maxVersion(versions: string[]): string | undefined {
  if (versions.length === 0) return undefined;
  return versions.reduce((acc, v) => {
    const a = tryParse(acc);
    const b = tryParse(v);
    if (!a) return v;
    if (!b) return acc;
    return compare(a, b) >= 0 ? acc : v;
  });
}

/**
 * Return the minimum version string from an array.
 */
export function minVersion(versions: string[]): string | undefined {
  if (versions.length === 0) return undefined;
  return versions.reduce((acc, v) => {
    const a = tryParse(acc);
    const b = tryParse(v);
    if (!a) return v;
    if (!b) return acc;
    return compare(a, b) <= 0 ? acc : v;
  });
}

/**
 * Find the best (highest) version from a list that satisfies a range.
 */
export function bestMatch(versions: string[], range: string): string | undefined {
  const candidates = versions.filter((v) => satisfies(v, range));
  return maxVersion(candidates);
}

/**
 * Format a SemVer back to a string (without build metadata).
 */
export function format(v: SemVer): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  return v.prerelease.length > 0 ? `${base}-${v.prerelease.join(".")}` : base;
}
