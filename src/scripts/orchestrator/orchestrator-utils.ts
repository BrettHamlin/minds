#!/usr/bin/env bun

/**
 * orchestrator-utils.ts - Shared utilities for orchestrator scripts
 *
 * Pure functions for repo root detection, JSON file I/O, and registry paths.
 * No side effects - all I/O is explicit in the function signatures.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

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
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
}

export function getRegistryPath(registryDir: string, ticketId: string): string {
  return path.join(registryDir, `${ticketId}.json`);
}
