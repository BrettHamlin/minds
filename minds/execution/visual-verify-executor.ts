#!/usr/bin/env bun
/**
 * visual-verify-executor.ts - Visual verification execution logic
 *
 * Reads .collab/config/visual-verify.json, fetches configured routes,
 * checks structural DOM selectors, and reports pass/fail/error.
 *
 * Separated from signal emission so it can be tested independently.
 *
 * Usage:
 *   bun visual-verify-executor.ts [--cwd <working-dir>]
 *
 * Output (stdout):
 *   VISUAL_VERIFY_COMPLETE | All structural checks passed
 *   VISUAL_VERIFY_FAILED | Structural: .feed-card not found on /briefing
 *   VISUAL_VERIFY_ERROR | <error message>
 *
 * Exit codes:
 *   0 = all checks passed (COMPLETE)
 *   1 = verification failed (FAILED)
 *   2 = execution error (ERROR — config missing, server unreachable, etc.)
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

interface RouteConfig {
  path: string;
  name: string;
  selectors: string[];
}

interface VisualVerifyConfig {
  baseUrl: string;
  startCommand?: string;
  readyPath?: string;
  readyTimeout?: number;
  routes: RouteConfig[];
}

function readConfig(repoRoot: string): VisualVerifyConfig | null {
  const configPath = path.join(repoRoot, ".collab/config/visual-verify.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content) as VisualVerifyConfig;
  } catch {
    return null;
  }
}

function truncateOutput(text: string, maxLen: number = 200): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

/**
 * Check if a selector exists in HTML content.
 * Supports simple selectors: tag, .class, #id, [attr]
 */
function selectorExistsInHtml(html: string, selector: string): boolean {
  if (selector.startsWith(".")) {
    // Class selector: .feed-card → class="feed-card" or class="... feed-card ..."
    const className = selector.substring(1);
    return new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`, "i").test(html);
  }
  if (selector.startsWith("#")) {
    // ID selector
    const id = selector.substring(1);
    return new RegExp(`id="${id}"`, "i").test(html);
  }
  if (selector.startsWith("[")) {
    // Attribute selector: [data-theme-toggle]
    const attr = selector.replace(/[\[\]]/g, "");
    return html.includes(attr);
  }
  // Tag selector: nav, footer, etc.
  return new RegExp(`<${selector}[\\s>]`, "i").test(html);
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
    console.log("VISUAL_VERIFY_ERROR | Config file .collab/config/visual-verify.json not found or malformed");
    process.exit(2);
  }

  if (!config.baseUrl) {
    console.log("VISUAL_VERIFY_ERROR | Config missing required 'baseUrl' field");
    process.exit(2);
  }

  if (!config.routes || config.routes.length === 0) {
    console.log("VISUAL_VERIFY_ERROR | Config missing required 'routes' field or routes is empty");
    process.exit(2);
  }

  // Structural checks: fetch each route, check selectors
  const failures: string[] = [];

  for (const route of config.routes) {
    const url = `${config.baseUrl}${route.path}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        failures.push(`HTTP ${response.status} on ${route.path}`);
        continue;
      }

      const html = await response.text();

      // Check each required selector
      for (const selector of route.selectors || []) {
        if (!selectorExistsInHtml(html, selector)) {
          failures.push(`${selector} not found on ${route.path}`);
        }
      }
    } catch (err: any) {
      failures.push(`Fetch failed for ${route.path}: ${err.message || err}`);
    }
  }

  if (failures.length > 0) {
    const detail = truncateOutput(`Structural: ${failures.join("; ")}`);
    console.log(`VISUAL_VERIFY_FAILED | ${detail}`);
    process.exit(1);
  }

  console.log("VISUAL_VERIFY_COMPLETE | All structural checks passed");
  process.exit(0);
}

main();
