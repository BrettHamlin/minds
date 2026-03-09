#!/usr/bin/env bun
/**
 * verify-execute-executor.ts - Verification checklist executor
 *
 * Reads .minds/config/verify-checklist.json, executes each check
 * by type, produces structured report.
 *
 * Usage:
 *   bun verify-execute-executor.ts [--cwd <working-dir>]
 *
 * Output (stdout, last line):
 *   VERIFY_EXECUTE_COMPLETE | 5/5 checks passed
 *   VERIFY_EXECUTE_FAILED | 3/5 passed, 2 failed: [file_exists] README.md, [http_200] /api/health
 *   VERIFY_EXECUTE_ERROR | <error message>
 *
 * Exit codes:
 *   0 = all checks passed (COMPLETE)
 *   1 = one or more checks failed (FAILED)
 *   2 = execution error (ERROR)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";

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

interface Check {
  type: "file_exists" | "file_contains" | "http_200" | "command_succeeds" | "json_field";
  label?: string;
  path?: string;
  pattern?: string;
  url?: string;
  command?: string;
  timeout?: number;
  field?: string;
  expected?: string;
}

interface AgentCheck {
  description: string;
  label?: string;
}

interface VerifyChecklistConfig {
  checks: Check[];
  agentChecks?: AgentCheck[];
}

function readConfig(repoRoot: string): VerifyChecklistConfig | null {
  const configPath = path.join(repoRoot, ".minds/config/verify-checklist.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content) as VerifyChecklistConfig;
  } catch {
    return null;
  }
}

function truncateOutput(text: string, maxLen: number = 200): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

function checkFileExists(repoRoot: string, check: Check): boolean {
  const fullPath = path.resolve(repoRoot, check.path!);
  return fs.existsSync(fullPath);
}

function checkFileContains(repoRoot: string, check: Check): boolean {
  const fullPath = path.resolve(repoRoot, check.path!);
  if (!fs.existsSync(fullPath)) return false;
  const content = fs.readFileSync(fullPath, "utf-8");
  return new RegExp(check.pattern!).test(content);
}

async function checkHttp200(check: Check): Promise<boolean> {
  try {
    const res = await fetch(check.url!);
    return res.ok;
  } catch {
    return false;
  }
}

function checkCommandSucceeds(repoRoot: string, check: Check): boolean {
  const timeout = (check.timeout || 30) * 1000;
  const result = spawnSync("sh", ["-c", check.command!], {
    encoding: "utf-8",
    cwd: repoRoot,
    timeout,
  });
  return result.status === 0;
}

function checkJsonField(repoRoot: string, check: Check): boolean {
  const fullPath = path.resolve(repoRoot, check.path!);
  if (!fs.existsSync(fullPath)) return false;
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    const json = JSON.parse(content);
    // Support nested fields with dot notation
    const parts = check.field!.split(".");
    let value: any = json;
    for (const part of parts) {
      if (value == null) return false;
      value = value[part];
    }
    return String(value) === String(check.expected);
  } catch {
    return false;
  }
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
      "VERIFY_EXECUTE_ERROR | Config file .minds/config/verify-checklist.json not found or malformed"
    );
    process.exit(2);
  }

  if (!config.checks) {
    console.log(
      "VERIFY_EXECUTE_ERROR | Config missing required 'checks' field"
    );
    process.exit(2);
  }

  // Vacuous pass: empty checks array
  if (config.checks.length === 0) {
    console.log("VERIFY_EXECUTE_COMPLETE | 0/0 checks passed");
    process.exit(0);
  }

  const total = config.checks.length;
  const failures: string[] = [];

  for (const check of config.checks) {
    let passed = false;

    try {
      switch (check.type) {
        case "file_exists":
          passed = checkFileExists(repoRoot, check);
          break;
        case "file_contains":
          passed = checkFileContains(repoRoot, check);
          break;
        case "http_200":
          passed = await checkHttp200(check);
          break;
        case "command_succeeds":
          passed = checkCommandSucceeds(repoRoot, check);
          break;
        case "json_field":
          passed = checkJsonField(repoRoot, check);
          break;
        default:
          failures.push(`[unknown] unsupported check type: ${(check as any).type}`);
          continue;
      }
    } catch (err: any) {
      failures.push(`[${check.type}] ${check.label || check.path || check.url || check.command}: ${err.message}`);
      continue;
    }

    if (!passed) {
      const label = check.label || check.path || check.url || check.command || "unknown";
      failures.push(`[${check.type}] ${label}`);
    }
  }

  if (failures.length > 0) {
    const passCount = total - failures.length;
    const detail = truncateOutput(
      `${passCount}/${total} passed, ${failures.length} failed: ${failures.join(", ")}`
    );
    console.log(`VERIFY_EXECUTE_FAILED | ${detail}`);
    process.exit(1);
  }

  console.log(`VERIFY_EXECUTE_COMPLETE | ${total}/${total} checks passed`);
  process.exit(0);
}

main();
