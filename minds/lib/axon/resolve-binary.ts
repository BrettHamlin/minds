import fs from "node:fs";
import path from "node:path";

/**
 * Resolves the Axon binary location at runtime.
 *
 * Resolution order:
 * 1. AXON_BINARY environment variable (explicit override)
 * 2. .minds/bin/axon in repo root (installed binary)
 * 3. axon on PATH (system-installed)
 * 4. null (not found)
 *
 * @param repoRoot - The root directory of the repository
 * @returns The absolute path to the axon binary, or null if not found
 */
export function resolveAxonBinary(repoRoot: string): string | null {
  // 1. Check AXON_BINARY environment variable
  const envBinary = process.env.AXON_BINARY;
  if (envBinary && isExecutable(envBinary)) {
    return envBinary;
  }

  // 2. Check .minds/bin/axon in repo root
  const localBinary = path.join(repoRoot, ".minds", "bin", "axon");
  if (isExecutable(localBinary)) {
    return localBinary;
  }

  // 3. Check PATH
  const pathBinary = Bun.which("axon");
  if (pathBinary) {
    return pathBinary;
  }

  // 4. Not found
  return null;
}

/**
 * Checks if a file exists and is executable.
 */
function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
