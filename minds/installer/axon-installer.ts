/**
 * Axon Binary Download Module (BRE-571 / AXN-INST-001)
 *
 * Downloads the correct Axon binary for the user's platform from GitHub Releases.
 * Verifies SHA256 checksum before installing.
 */

import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { chmod, mkdir, rename, rm } from "fs/promises";
import { spawnSync } from "child_process";

export interface InstallOptions {
  version: string;
  targetDir: string; // e.g., ".minds/bin"
  repoOwner?: string; // default: "BrettHamlin"
  repoName?: string; // default: "axon"
}

export interface InstallResult {
  binaryPath: string;
  version: string;
  platform: string;
  arch: string;
}

/**
 * Platform mapping: process.platform + process.arch -> target triple
 */
const PLATFORM_MAP: Record<string, Record<string, string>> = {
  darwin: {
    arm64: "aarch64-apple-darwin",
    x64: "x86_64-apple-darwin",
  },
  linux: {
    arm64: "aarch64-unknown-linux-gnu",
    x64: "x86_64-unknown-linux-gnu",
  },
};

/**
 * Get the target triple for an explicit platform/arch combination.
 * Exported for testing all 4 platform mappings without mocking process globals.
 */
export function getTargetTripleFor(platform: string, arch: string): string {
  const archMap = PLATFORM_MAP[platform];
  if (!archMap) {
    throw new Error(
      `Unsupported platform: "${platform}". Supported: darwin, linux`
    );
  }
  const triple = archMap[arch];
  if (!triple) {
    throw new Error(
      `Unsupported arch "${arch}" for platform "${platform}". Supported: arm64, x64`
    );
  }
  return triple;
}

/**
 * Get the target triple for the current platform.
 */
export function getTargetTriple(): string {
  return getTargetTripleFor(process.platform, process.arch);
}

/**
 * Read the pinned version from axon-version.json in the given directory.
 * Returns null if the file doesn't exist or is malformed.
 */
export function getPinnedVersion(repoRoot: string): string | null {
  const versionFile = join(repoRoot, "axon-version.json");
  try {
    if (!existsSync(versionFile)) {
      return null;
    }
    const content = readFileSync(versionFile, "utf-8");
    const parsed = JSON.parse(content);
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute SHA256 hash of a Uint8Array using Bun's CryptoHasher.
 */
function sha256(data: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

/**
 * Parse checksums.txt content and find the hash for a given filename.
 * Format: "<hash>  <filename>\n" (two spaces between hash and filename)
 */
function findChecksum(
  checksumContent: string,
  filename: string
): string | null {
  for (const line of checksumContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: hash  filename (two spaces)
    const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (match && match[2] === filename) {
      return match[1];
    }
  }
  return null;
}

/**
 * Download and install the Axon binary for the current platform.
 */
/**
 * Validate version string to prevent path traversal in URLs.
 */
function validateVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    throw new Error(`Invalid version format: "${version}"`);
  }
}

export async function installAxon(
  options: InstallOptions
): Promise<InstallResult> {
  const {
    version,
    targetDir,
    repoOwner = "BrettHamlin",
    repoName = "axon",
  } = options;

  validateVersion(version);

  const triple = getTargetTriple();
  const binaryFilename = `axon-${triple}`;
  const baseUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/v${version}`;
  const binaryUrl = `${baseUrl}/${binaryFilename}`;
  const checksumUrl = `${baseUrl}/checksums.txt`;

  // Download checksums first (fail fast before downloading the larger binary)
  const checksumResponse = await fetch(checksumUrl);
  if (!checksumResponse.ok) {
    throw new Error(
      `Download failed: ${checksumUrl} returned HTTP ${checksumResponse.status}`
    );
  }
  const checksumContent = await checksumResponse.text();

  const expectedHash = findChecksum(checksumContent, binaryFilename);
  if (!expectedHash) {
    throw new Error(
      `Checksum not found for "${binaryFilename}" in checksums.txt`
    );
  }

  // Download binary
  const binaryResponse = await fetch(binaryUrl);
  if (!binaryResponse.ok) {
    throw new Error(
      `Download failed: ${binaryUrl} returned HTTP ${binaryResponse.status}`
    );
  }
  const binaryData = new Uint8Array(await binaryResponse.arrayBuffer());

  // Verify checksum
  const actualHash = sha256(binaryData);
  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for ${binaryFilename}: expected ${expectedHash}, got ${actualHash}`
    );
  }

  // Ensure target directory exists
  await mkdir(targetDir, { recursive: true });

  // Atomic write: write to temp file, chmod, then rename to final path
  const binaryPath = join(targetDir, "axon");
  const tmpPath = `${binaryPath}.tmp.${process.pid}`;
  try {
    await Bun.write(tmpPath, binaryData);
    await chmod(tmpPath, 0o755);
    await rename(tmpPath, binaryPath);
  } catch (e) {
    await rm(tmpPath, { force: true });
    throw e;
  }

  return {
    binaryPath,
    version,
    platform: process.platform,
    arch: process.arch,
  };
}

// ---------------------------------------------------------------------------
// BRE-575: Version pinning and upgrade path
// ---------------------------------------------------------------------------

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export interface VersionCheck {
  installed: string | null; // null = not installed
  pinned: string;
  minVersion: string;
  needsUpgrade: boolean; // installed < minVersion (or not installed)
  upgradeAvailable: boolean; // installed < pinned but >= minVersion
}

export interface PinnedVersionInfo {
  version: string;
  minVersion: string;
}

/**
 * Parse a semver string "major.minor.patch" into its components.
 * Returns null if the string is not valid semver.
 */
export function parseSemver(version: string): SemVer | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Compare two semver strings.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b.
 * Throws if either version is not valid semver.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa) throw new Error(`Invalid semver: "${a}"`);
  if (!pb) throw new Error(`Invalid semver: "${b}"`);

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return 0;
}

/**
 * Read full version info (version + minVersion) from axon-version.json.
 * If minVersion is not specified, it defaults to version.
 * Returns null if the file doesn't exist or is malformed.
 */
export function getPinnedVersionInfo(dir: string): PinnedVersionInfo | null {
  const versionFile = join(dir, "axon-version.json");
  try {
    if (!existsSync(versionFile)) return null;
    const content = readFileSync(versionFile, "utf-8");
    const parsed = JSON.parse(content);
    const version = parsed.version;
    if (typeof version !== "string") return null;
    return {
      version,
      minVersion: parsed.minVersion ?? version,
    };
  } catch {
    return null;
  }
}

/**
 * Extract version string from `axon version` output.
 * Handles formats like "axon 0.1.0" or "axon 0.1.0 (built 2025-01-01)".
 */
function parseAxonVersionOutput(output: string): string | null {
  const match = output.trim().match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Check the installed Axon version against pinned version requirements.
 *
 * @param repoRoot - The target repo root (binary at .minds/bin/axon)
 * @param installerDir - Directory containing axon-version.json
 */
export async function checkAxonVersion(
  repoRoot: string,
  installerDir: string,
): Promise<VersionCheck> {
  const info = getPinnedVersionInfo(installerDir);
  const pinned = info?.version ?? "0.1.0";
  const minVersion = info?.minVersion ?? pinned;

  const binaryPath = join(repoRoot, ".minds", "bin", "axon");

  // Check if binary exists
  if (!existsSync(binaryPath)) {
    return {
      installed: null,
      pinned,
      minVersion,
      needsUpgrade: true,
      upgradeAvailable: false,
    };
  }

  // Try to get installed version
  let installed: string | null = null;
  try {
    const result = spawnSync(binaryPath, ["version"], {
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0 && result.stdout) {
      installed = parseAxonVersionOutput(result.stdout.toString());
    }
  } catch {
    // Binary exists but can't execute - treat as not installed
  }

  if (installed === null) {
    return {
      installed: null,
      pinned,
      minVersion,
      needsUpgrade: true,
      upgradeAvailable: false,
    };
  }

  const belowMin = compareSemver(installed, minVersion) < 0;
  const belowPinned = compareSemver(installed, pinned) < 0;

  return {
    installed,
    pinned,
    minVersion,
    needsUpgrade: belowMin,
    upgradeAvailable: !belowMin && belowPinned,
  };
}
