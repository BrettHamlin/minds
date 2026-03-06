#!/usr/bin/env bun
/**
 * pre-deploy-summary.ts - Deployment context aggregator
 *
 * Gathers deployment context from spec, metadata, and config files.
 * Outputs structured JSON for the human gate AskUserQuestion.
 *
 * Usage:
 *   bun pre-deploy-summary.ts [--cwd <working-dir>]
 *
 * Output (stdout):
 *   JSON object with deployment context fields
 *
 * Exit codes:
 *   0 = context gathered successfully
 *   2 = error (unreadable directory, catastrophic failure)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { readMetadataJson } from "../pipeline_core";

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

interface DeploySummary {
  service?: string;
  branch?: string;
  targetEnv?: string;
  productionUrl?: string;
  smokeRoutes?: string[];
  ticketId?: string;
  ticketTitle?: string;
  pipelineVariant?: string;
  acSummary?: string[];
  changedFiles?: number;
  testsStatus?: string;
  warnings: string[];
}

function findSpecDir(repoRoot: string): string | null {
  const specsDir = path.join(repoRoot, "specs");
  if (!fs.existsSync(specsDir)) return null;

  try {
    const entries = fs.readdirSync(specsDir);
    for (const entry of entries) {
      const specPath = path.join(specsDir, entry, "spec.md");
      if (fs.existsSync(specPath)) {
        return path.join(specsDir, entry);
      }
    }
  } catch {
    // Can't read specs directory
  }
  return null;
}

function extractTitle(specContent: string): string | null {
  const lines = specContent.split("\n");
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

function extractAcItems(specContent: string): string[] {
  const items: string[] = [];
  const lines = specContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^-\s*\[[ x]\]/.test(trimmed) || /^-\s*AC\d/i.test(trimmed)) {
      items.push(trimmed.replace(/^-\s*\[[ x]\]\s*/, "").replace(/^-\s*/, ""));
    }
  }
  return items;
}

function getChangedFileCount(repoRoot: string): number | null {
  try {
    const output = execSync("git diff --stat HEAD~1", {
      encoding: "utf-8",
      cwd: repoRoot,
    });
    const lines = output.trim().split("\n");
    if (lines.length === 0) return 0;
    const lastLine = lines[lines.length - 1];
    const match = lastLine.match(/(\d+)\s+files?\s+changed/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return null;
  }
}

function getTestsStatus(repoRoot: string, ticketId: string): string | null {
  const registryPath = path.join(
    repoRoot,
    ".collab/state/pipeline-registry",
    `${ticketId}.json`
  );
  if (!fs.existsSync(registryPath)) return null;
  try {
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    if (
      Array.isArray(registry.phase_history) &&
      registry.phase_history.includes("run_tests")
    ) {
      return "passed";
    }
    return "unknown";
  } catch {
    return null;
  }
}

function getBranch(repoRoot: string): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      cwd: repoRoot,
    }).trim();
  } catch {
    return null;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const cwdIdx = args.indexOf("--cwd");
  const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? args[cwdIdx + 1] : undefined;

  let repoRoot: string;
  try {
    repoRoot = getRepoRoot(cwd);
    if (!fs.existsSync(repoRoot)) {
      console.log(JSON.stringify({ error: "Working directory does not exist" }));
      process.exit(2);
    }
  } catch (err: any) {
    console.log(
      JSON.stringify({ error: `Failed to resolve repo root: ${err.message}` })
    );
    process.exit(2);
  }

  const summary: DeploySummary = { warnings: [] };

  // Read spec directory
  const specDir = findSpecDir(repoRoot);
  if (specDir) {
    // Read spec.md
    const specPath = path.join(specDir, "spec.md");
    try {
      const specContent = fs.readFileSync(specPath, "utf-8");
      summary.ticketTitle = extractTitle(specContent) || undefined;
      const acItems = extractAcItems(specContent);
      if (acItems.length > 0) summary.acSummary = acItems;
    } catch {
      summary.warnings.push("spec.md found but unreadable");
    }

    // Read metadata.json via shared utility (handles key normalization)
    const metadata = readMetadataJson(specDir);
    if (metadata) {
      summary.ticketId = metadata.ticket_id || undefined;
      summary.branch = metadata.branch_name || undefined;
      summary.pipelineVariant = metadata.pipeline_variant || undefined;
      summary.service = (metadata.project_name as string | undefined) || (metadata.service as string | undefined) || undefined;
    } else if (fs.existsSync(path.join(specDir, "metadata.json"))) {
      summary.warnings.push("metadata.json found but malformed");
    } else {
      summary.warnings.push("metadata.json not found in spec directory");
    }
  } else {
    summary.warnings.push("No spec directory found (specs/*/spec.md)");
  }

  // Read deploy-verify.json
  const deployConfigPath = path.join(
    repoRoot,
    ".collab/config/deploy-verify.json"
  );
  if (fs.existsSync(deployConfigPath)) {
    try {
      const deployConfig = JSON.parse(
        fs.readFileSync(deployConfigPath, "utf-8")
      );
      summary.productionUrl = deployConfig.productionUrl || undefined;
      summary.smokeRoutes = deployConfig.smokeRoutes || undefined;
    } catch {
      summary.warnings.push("deploy-verify.json found but malformed");
    }
  } else {
    summary.warnings.push("deploy-verify.json not found");
  }

  // Git branch (fallback if metadata didn't have it)
  if (!summary.branch) {
    summary.branch = getBranch(repoRoot) || undefined;
  }

  // Changed file count
  const changedFiles = getChangedFileCount(repoRoot);
  if (changedFiles !== null) {
    summary.changedFiles = changedFiles;
  }

  // Tests status from registry
  if (summary.ticketId) {
    const testsStatus = getTestsStatus(repoRoot, summary.ticketId);
    if (testsStatus) summary.testsStatus = testsStatus;
  }

  // Default target environment
  summary.targetEnv = "production";

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

main();
