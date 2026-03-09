/**
 * collab pipeline init — scaffold pipeline.json from directory introspection
 * Scans commands/ for .md files, generates a starter manifest with all required fields.
 * Pure functions exported for testability; interactive I/O lives in the CLI entry point.
 */

import {
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  mkdirSync,
} from "node:fs";
import { join, basename } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InitOptions {
  /** Directory to scaffold in (default: ".") */
  path?: string;
  /** Pipeline name (default: directory basename) */
  name?: string;
  /** Version string (default: "0.1.0") */
  version?: string;
  /** Pipeline or pack (default: "pipeline") */
  type?: "pipeline" | "pack";
  /** Description (defaults to empty string) */
  description?: string;
  /** CLI dependencies: name → semver range */
  clis?: Record<string, string>;
  /** Pipeline deps (pipeline type) or bundled pipelines (pack type): name → semver range */
  pipelines?: Record<string, string>;
  /** Overwrite existing pipeline.json without diff prompt */
  force?: boolean;
}

export interface GenerateManifestOpts {
  name: string;
  version: string;
  type: "pipeline" | "pack";
  description: string;
  commands: string[];
  clis: Record<string, string>;
  pipelines: Record<string, string>;
}

export interface InitResult {
  /** Whether pipeline.json was written to disk */
  written: boolean;
  /**
   * Diff string when an existing file was found and force is false.
   * null when the file was freshly created.
   */
  diff: string | null;
  /** The generated manifest object */
  manifest: Record<string, unknown>;
  /** Non-fatal warnings (e.g., no command files found) */
  warnings: string[];
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Scan a pipeline directory for command .md files.
 * Looks in the commands/ subdirectory first; falls back to collab.*.md in the
 * top-level directory when no commands/ dir exists.
 * Returns just filenames, sorted alphabetically.
 */
export function scanCommandFiles(dir: string): string[] {
  const commandsDir = join(dir, "commands");
  if (existsSync(commandsDir)) {
    return readdirSync(commandsDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
  }
  // Fallback: collab.*.md at top level
  return readdirSync(dir)
    .filter((f) => f.startsWith("collab.") && f.endsWith(".md"))
    .sort();
}

/**
 * Build a pipeline.json manifest object.
 * For pack type: no commands[] field.
 * For pipeline type: no commands[] omitted even when empty.
 */
export function generateManifest(opts: GenerateManifestOpts): Record<string, unknown> {
  if (opts.type === "pack") {
    const manifest: Record<string, unknown> = {
      name: opts.name,
      version: opts.version,
      type: "pack",
      description: opts.description,
      pipelines: opts.pipelines,
    };
    if (Object.keys(opts.clis).length > 0) manifest.clis = opts.clis;
    return manifest;
  }

  // pipeline type
  const manifest: Record<string, unknown> = {
    name: opts.name,
    version: opts.version,
    type: "pipeline",
    description: opts.description,
    // Legacy array fields kept for backward compat with tools that read them
    dependencies: [],
    cliDependencies: [],
    commands: opts.commands,
  };
  if (Object.keys(opts.pipelines).length > 0) manifest.pipelines = opts.pipelines;
  if (Object.keys(opts.clis).length > 0) manifest.clis = opts.clis;
  return manifest;
}

/**
 * Produce a simple line-level diff between two strings.
 * Lines present only in old are prefixed "-"; lines only in new are prefixed "+".
 */
function simpleDiff(oldContent: string, newContent: string): string {
  if (oldContent === newContent) return "";
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const result: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const a = oldLines[i];
    const b = newLines[i];
    if (a === b) {
      result.push(` ${a ?? ""}`);
    } else {
      if (a !== undefined) result.push(`-${a}`);
      if (b !== undefined) result.push(`+${b}`);
    }
  }
  return result.join("\n");
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Scaffold (or update) a pipeline.json in the target directory.
 * Returns an InitResult — never calls process.exit(), so callers can
 * decide how to handle the result (print diff, ask user, etc.).
 */
export async function init(options: InitOptions = {}): Promise<InitResult> {
  const dir = options.path ?? ".";
  const type = options.type ?? "pipeline";
  const version = options.version ?? "1.0.0";
  const name = options.name ?? basename(dir);
  const defaultDescription = type === "pack" ? "A collab pack" : "A collab pipeline";
  const description = options.description ?? defaultDescription;
  const clis = options.clis ?? {};
  const pipelines = options.pipelines ?? {};
  const warnings: string[] = [];

  // Scan command files (pipeline only)
  let commands: string[] = [];
  if (type === "pipeline") {
    try {
      commands = scanCommandFiles(dir);
      if (commands.length === 0) {
        warnings.push("No .md command files found in commands/ directory");
      }
    } catch {
      warnings.push(`Could not scan commands directory: ${dir}`);
    }
  }

  const manifest = generateManifest({
    name,
    version,
    type,
    description,
    commands,
    clis,
    pipelines,
  });
  const json = JSON.stringify(manifest, null, 2) + "\n";
  const outputPath = join(dir, "pipeline.json");

  // Existing file — return diff without writing (unless forced)
  if (existsSync(outputPath) && !options.force) {
    const existingContent = readFileSync(outputPath, "utf8");
    const diff = simpleDiff(existingContent, json);
    return { written: false, diff, manifest, warnings };
  }

  // Create commands/ subdir for pipeline type if absent
  if (type === "pipeline") {
    const commandsDir = join(dir, "commands");
    if (!existsSync(commandsDir)) {
      mkdirSync(commandsDir, { recursive: true });
    }
  }

  writeFileSync(outputPath, json, "utf8");
  return { written: true, diff: null, manifest, warnings };
}
