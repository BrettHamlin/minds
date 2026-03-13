/**
 * Axon Binary Download Module (BRE-571 / AXN-INST-001)
 *
 * Downloads the correct Axon binary for the user's platform from GitHub Releases.
 * Verifies SHA256 checksum before installing.
 */

import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { chmod, mkdir } from "fs/promises";

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
export async function installAxon(
  options: InstallOptions
): Promise<InstallResult> {
  const {
    version,
    targetDir,
    repoOwner = "BrettHamlin",
    repoName = "axon",
  } = options;

  const triple = getTargetTriple();
  const binaryFilename = `axon-${triple}`;
  const baseUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/v${version}`;
  const binaryUrl = `${baseUrl}/${binaryFilename}`;
  const checksumUrl = `${baseUrl}/checksums.txt`;

  // Download binary
  const binaryResponse = await fetch(binaryUrl);
  if (!binaryResponse.ok) {
    throw new Error(
      `Download failed: ${binaryUrl} returned HTTP ${binaryResponse.status}`
    );
  }
  const binaryData = new Uint8Array(await binaryResponse.arrayBuffer());

  // Download checksums
  const checksumResponse = await fetch(checksumUrl);
  if (!checksumResponse.ok) {
    throw new Error(
      `Download failed: ${checksumUrl} returned HTTP ${checksumResponse.status}`
    );
  }
  const checksumContent = await checksumResponse.text();

  // Verify checksum
  const expectedHash = findChecksum(checksumContent, binaryFilename);
  if (!expectedHash) {
    throw new Error(
      `Checksum not found for "${binaryFilename}" in checksums.txt`
    );
  }

  const actualHash = sha256(binaryData);
  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for ${binaryFilename}: expected ${expectedHash}, got ${actualHash}`
    );
  }

  // Ensure target directory exists
  await mkdir(targetDir, { recursive: true });

  // Write binary
  const binaryPath = join(targetDir, "axon");
  await Bun.write(binaryPath, binaryData);

  // Make executable
  await chmod(binaryPath, 0o755);

  return {
    binaryPath,
    version,
    platform: process.platform,
    arch: process.arch,
  };
}
