/**
 * Portable transport module resolver.
 *
 * Resolves absolute paths to transport implementations that work both in the
 * collab dev repo (transport/ at root) and in installed repos (only .collab/).
 *
 * Usage:
 *   const { BusTransport } = await import(resolveTransportPath("BusTransport.ts"));
 */

import * as path from "path";
import * as fs from "fs";

const thisDir = path.dirname(new URL(import.meta.url).pathname);
// minds/transport/ is 2 levels down from repo root
const repoRoot = path.resolve(thisDir, "../..");

/**
 * Returns the absolute path to a transport module, preferring .collab/transport/
 * (installed) over transport/ (dev repo source).
 */
export function resolveTransportPath(moduleName: string): string {
  const installed = path.join(repoRoot, ".collab", "transport", moduleName);
  if (fs.existsSync(installed)) return installed;
  return path.join(repoRoot, "minds", "transport", moduleName);
}
