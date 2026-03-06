#!/usr/bin/env bun
/**
 * run-tests-executor.ts - Test suite executor logic
 *
 * Reads .collab/config/run-tests.json, executes the configured test command,
 * captures output, and prints the result verdict (pass/fail/error) with details.
 *
 * Separated from signal emission so it can be tested independently.
 *
 * Usage:
 *   bun run-tests-executor.ts [--cwd <working-dir>]
 *
 * Output (stdout):
 *   RUN_TESTS_COMPLETE | All tests passed
 *   RUN_TESTS_FAILED | <test output excerpt>
 *   RUN_TESTS_ERROR | <error message>
 *
 * Exit codes:
 *   0 = tests passed (COMPLETE)
 *   1 = tests failed (FAILED)
 *   2 = execution error (ERROR — config missing, command not found, etc.)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { spawnSync } from "child_process";

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

interface RunTestsConfig {
  command: string;
  workingDir?: string;
  timeout?: number;
  requiredTestFiles?: string[];
}

function readConfig(repoRoot: string): RunTestsConfig | null {
  const configPath = path.join(repoRoot, ".collab/config/run-tests.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content) as RunTestsConfig;
  } catch (err) {
    return null;
  }
}

function truncateOutput(text: string, maxLen: number = 200): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

function main(): void {
  // Parse --cwd argument
  const args = process.argv.slice(2);
  const cwdIdx = args.indexOf("--cwd");
  const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? args[cwdIdx + 1] : undefined;

  const repoRoot = getRepoRoot(cwd);

  // Read config
  const config = readConfig(repoRoot);
  if (!config) {
    console.log("RUN_TESTS_ERROR | Config file .collab/config/run-tests.json not found or malformed");
    process.exit(2);
  }

  if (!config.command) {
    console.log("RUN_TESTS_ERROR | Config missing required 'command' field");
    process.exit(2);
  }

  // Resolve working directory
  const workDir = config.workingDir
    ? path.resolve(repoRoot, config.workingDir)
    : repoRoot;

  // Execute test command
  const timeout = (config.timeout || 120) * 1000; // convert to ms
  try {
    const result = spawnSync("sh", ["-c", config.command], {
      encoding: "utf-8",
      cwd: workDir,
      timeout,
      env: { ...process.env },
    });

    const output = (result.stdout || "") + (result.stderr || "");

    if (result.status === 0) {
      // Check required test files if configured
      if (config.requiredTestFiles && config.requiredTestFiles.length > 0) {
        const missing = config.requiredTestFiles.filter(
          (f) => !output.includes(f)
        );
        if (missing.length > 0) {
          console.log(
            `RUN_TESTS_FAILED | Required test files not found in output: ${missing.join(", ")}`
          );
          process.exit(1);
        }
      }

      console.log("RUN_TESTS_COMPLETE | All tests passed");
      process.exit(0);
    } else {
      console.log(`RUN_TESTS_FAILED | ${truncateOutput(output.trim())}`);
      process.exit(1);
    }
  } catch (err: any) {
    if (err.code === "ETIMEDOUT" || err.killed) {
      console.log(
        `RUN_TESTS_ERROR | Test command timed out after ${config.timeout || 120}s`
      );
    } else {
      console.log(
        `RUN_TESTS_ERROR | Test command failed to execute: ${err.message || err}`
      );
    }
    process.exit(2);
  }
}

main();
