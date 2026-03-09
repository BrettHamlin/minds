#!/usr/bin/env bun
/**
 * deploy-verify-executor.ts - Post-deploy smoke verification
 *
 * Reads .minds/config/deploy-verify.json, polls production URL,
 * checks smoke routes for HTTP 200, captures response times.
 *
 * Usage:
 *   bun deploy-verify-executor.ts [--cwd <working-dir>]
 *
 * Output (stdout):
 *   DEPLOY_VERIFY_COMPLETE | All smoke routes healthy
 *   DEPLOY_VERIFY_FAILED | /briefing returned 503, / response 8200ms
 *   DEPLOY_VERIFY_ERROR | <error message>
 *
 * Exit codes:
 *   0 = all routes healthy (COMPLETE)
 *   1 = verification failed (FAILED)
 *   2 = execution error (ERROR)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

function getRepoRoot(cwd?: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      cwd: cwd || process.cwd(),
    }).trim();
  } catch {
    return cwd || process.cwd();
  }
}

interface DeployVerifyConfig {
  productionUrl: string;
  smokeRoutes: string[];
  pollIntervalSeconds?: number;
  maxWaitSeconds?: number;
}

function readConfig(repoRoot: string): DeployVerifyConfig | null {
  const configPath = path.join(repoRoot, ".minds/config/deploy-verify.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content) as DeployVerifyConfig;
  } catch {
    return null;
  }
}

function truncateOutput(text: string, maxLen: number = 200): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

async function pollUntilReady(
  url: string,
  pollInterval: number,
  maxWait: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait * 1000) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, pollInterval * 1000));
  }
  return false;
}

async function main(): Promise<void> {
  // Parse --cwd argument
  const args = process.argv.slice(2);
  const cwdIdx = args.indexOf("--cwd");
  const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? args[cwdIdx + 1] : undefined;

  const repoRoot = getRepoRoot(cwd);

  // Read config
  const config = readConfig(repoRoot);
  if (!config) {
    console.log(
      "DEPLOY_VERIFY_ERROR | Config file .minds/config/deploy-verify.json not found or malformed"
    );
    process.exit(2);
  }

  if (!config.productionUrl) {
    console.log(
      "DEPLOY_VERIFY_ERROR | Config missing required 'productionUrl' field"
    );
    process.exit(2);
  }

  if (!config.smokeRoutes || config.smokeRoutes.length === 0) {
    console.log(
      "DEPLOY_VERIFY_ERROR | Config missing required 'smokeRoutes' field or smokeRoutes is empty"
    );
    process.exit(2);
  }

  const pollInterval = config.pollIntervalSeconds ?? 15;
  const maxWait = config.maxWaitSeconds ?? 300;

  // Poll production URL until ready
  const ready = await pollUntilReady(config.productionUrl, pollInterval, maxWait);
  if (!ready) {
    console.log(
      `DEPLOY_VERIFY_FAILED | Production URL ${config.productionUrl} not responding after ${maxWait}s`
    );
    process.exit(1);
  }

  // Check each smoke route
  const failures: string[] = [];

  for (const route of config.smokeRoutes) {
    const url = `${config.productionUrl}${route}`;
    try {
      const start = Date.now();
      const res = await fetch(url);
      const elapsed = Date.now() - start;

      if (!res.ok) {
        failures.push(`${route} returned ${res.status}`);
      } else if (elapsed > 5000) {
        failures.push(`${route} response ${elapsed}ms`);
      }
    } catch (err: any) {
      failures.push(`${route} fetch failed: ${err.message || err}`);
    }
  }

  if (failures.length > 0) {
    const detail = truncateOutput(failures.join(", "));
    console.log(`DEPLOY_VERIFY_FAILED | ${detail}`);
    process.exit(1);
  }

  console.log("DEPLOY_VERIFY_COMPLETE | All smoke routes healthy");
  process.exit(0);
}

main();
