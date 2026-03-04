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
