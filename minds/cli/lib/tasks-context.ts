/**
 * tasks-context.ts — Deterministic context builder for the tasks CLI.
 *
 * Every function here is pure: reads files, returns data. No LLM calls.
 * These replace the 8 LLM steps that caused failures in the old tasks prompt.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { MindDescription } from "../../mind.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TestFramework = "bun:test" | "playwright" | "vitest";

export interface TasksContext {
  repoRoot: string;
  mindsDir: string;
  registry: MindDescription[];
  featureDir: string;
  ticketId: string;
  testFramework: TestFramework;
  hasE2eInfra: boolean;
  e2eRegistrySchema: { mind: string; file: string } | null;
  mockupPath: string | null;
}

// ---------------------------------------------------------------------------
// Test Framework Detection
// ---------------------------------------------------------------------------

/**
 * Detect the test framework used by the project.
 * Checks package.json dependencies, then falls back to scanning test file imports.
 */
export function detectTestFramework(repoRoot: string): TestFramework {
  // Scan existing test files and vote — actual usage beats package.json declarations.
  // A project may have @playwright/test in devDeps for browser testing but use
  // bun:test for the vast majority of its test suite.
  const votes: Record<TestFramework, number> = { "bun:test": 0, "playwright": 0, "vitest": 0 };
  const MAX_SAMPLES = 5;
  let sampled = 0;

  const testDirs = ["tests", "test", "src"];
  for (const dir of testDirs) {
    if (sampled >= MAX_SAMPLES) break;
    const dirPath = join(repoRoot, dir);
    if (!existsSync(dirPath)) continue;
    const files = findTestFiles(dirPath, MAX_SAMPLES - sampled);
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      if (content.includes("bun:test")) votes["bun:test"]++;
      else if (content.includes("from \"vitest\"") || content.includes("from 'vitest'")) votes["vitest"]++;
      else if (content.includes("@playwright/test")) votes["playwright"]++;
      sampled++;
    }
  }

  // Return the framework with the most votes
  if (sampled > 0) {
    const winner = (Object.entries(votes) as [TestFramework, number][])
      .sort((a, b) => b[1] - a[1])[0];
    if (winner[1] > 0) return winner[0];
  }

  // Fall back to package.json if no test files found
  const pkgPath = join(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };
      if (allDeps["vitest"]) return "vitest";
      if (allDeps["@playwright/test"]) return "playwright";
    } catch {
      // Malformed package.json — fall through
    }
  }

  return "bun:test"; // default
}

/** Find up to `max` .test.ts files in a directory tree (shallow scan, max depth 3). */
function findTestFiles(dir: string, max: number, depth = 0): string[] {
  const results: string[] = [];
  if (depth > 3 || results.length >= max) return results;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= max) break;
      if (entry.isFile() && /\.test\.(ts|js|tsx|jsx)$/.test(entry.name)) {
        results.push(join(dir, entry.name));
      }
    }
    for (const entry of entries) {
      if (results.length >= max) break;
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        results.push(...findTestFiles(join(dir, entry.name), max - results.length, depth + 1));
      }
    }
  } catch {
    // Permission error or similar — skip
  }
  return results;
}

// ---------------------------------------------------------------------------
// Mockup Detection
// ---------------------------------------------------------------------------

/**
 * Extract a mockup file path from a ticket description.
 * Looks for literal paths starting with ~/ and ending in .html, .png, or .fig.
 */
export function detectMockupPath(ticketDescription: string): string | null {
  const match = ticketDescription.match(/~\/[^\s,)]+\.(html|png|fig)/);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// E2E Infrastructure Detection
// ---------------------------------------------------------------------------

export interface E2eInfraInfo {
  hasRegistry: boolean;
  schema: { mindKey: string; fileKey: string } | null;
}

/**
 * Check if E2E test infrastructure exists and detect the registry schema.
 * Reads an existing entry from registry.json to infer the key names.
 */
export function detectE2eInfra(repoRoot: string): E2eInfraInfo {
  const registryPath = join(repoRoot, "tests", "e2e", "registry.json");
  if (!existsSync(registryPath)) {
    return { hasRegistry: false, schema: null };
  }

  try {
    const content = JSON.parse(readFileSync(registryPath, "utf-8"));
    if (Array.isArray(content.tests) && content.tests.length > 0) {
      const first = content.tests[0];
      // Infer key names from first entry
      const keys = Object.keys(first);
      const mindKey = keys.find(k => k === "mind" || k === "label" || k === "module") ?? "mind";
      const fileKey = keys.find(k => k === "file" || k === "path") ?? "file";
      return { hasRegistry: true, schema: { mindKey, fileKey } };
    }
    return { hasRegistry: true, schema: null };
  } catch {
    return { hasRegistry: true, schema: null };
  }
}

// ---------------------------------------------------------------------------
// E2E Task Generation (deterministic)
// ---------------------------------------------------------------------------

/**
 * Build the E2E task description for a mind.
 * Includes correct test framework, in-process server, mockup comparison, and registry schema.
 */
export function buildE2eTaskDescription(ctx: TasksContext, mindName: string): string {
  const testFile = `tests/e2e/${mindName}.test.ts`;
  const parts: string[] = [];

  parts.push(`Write E2E test at ${testFile}`);

  if (ctx.testFramework === "bun:test") {
    parts.push("using bun:test with in-process server on port 0 (createServer from packages/core/server.ts)");
  } else if (ctx.testFramework === "playwright") {
    parts.push("using @playwright/test");
  } else {
    parts.push(`using ${ctx.testFramework}`);
  }

  if (ctx.mockupPath) {
    parts.push(`— visual structure comparison against ${ctx.mockupPath} (extract IDs, headings, sidebar items, panels; assert key sections from mockup exist in live page)`);
  }

  const mindKey = ctx.e2eRegistrySchema?.mind ?? "mind";
  const fileKey = ctx.e2eRegistrySchema?.file ?? "file";
  parts.push(`— register in tests/e2e/registry.json as { "${mindKey}": "@${mindName}", "${fileKey}": "${testFile}" }`);

  return parts.join(" ");
}

/**
 * Return the owns: extension needed for E2E tests.
 */
export function buildE2eBoundaryExtension(mindName: string): string {
  return `tests/e2e/${mindName}*`;
}

