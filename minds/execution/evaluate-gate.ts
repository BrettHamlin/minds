#!/usr/bin/env bun

/**
 * evaluate-gate.ts — Deterministic gate prompt resolution and verdict validation
 *
 * Separates the deterministic infrastructure work from the LLM judgment call:
 *   - Resolves gate prompt tokens so the LLM gets fully substituted content
 *   - Validates the LLM's verdict against the pipeline config (no free-text errors)
 *
 * Mode 1 — Resolve prompt (default):
 *   bun evaluate-gate.ts <TICKET_ID> <GATE_NAME>
 *   Output (JSON): { "prompt": "<resolved text>", "validKeywords": ["APPROVED", ...] }
 *   Exit 0 = resolved successfully
 *   Exit 1 = usage error
 *   Exit 3 = gate not found in pipeline config (LLM should fall back to AC review)
 *
 * Mode 2 — Validate verdict:
 *   bun evaluate-gate.ts <TICKET_ID> <GATE_NAME> --verdict <KEYWORD>
 *   Output (JSON): { "keyword": "<KEYWORD>", "response": { "to": "tasks", ... } }
 *   Exit 0 = keyword is valid, response contains routing instructions
 *   Exit 1 = usage error
 *   Exit 2 = invalid keyword (stderr lists valid keywords)
 *   Exit 3 = gate not found in pipeline config
 *
 * Token resolution in gate prompts:
 *   Gate prompt files may contain YAML front matter with a `context:` block that
 *   maps variable names to file paths (which may reference ${TICKET_ID}).
 *   The prompt body uses ${VAR_NAME} which is replaced with the file's content.
 *   Built-in tokens ${TICKET_ID} and ${PHASE} are also resolved in the body.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { getRepoRoot, loadPipelineForTicket, validateTicketIdArg } from "../pipeline_core";

// ── YAML front matter parsing ─────────────────────────────────────────────────

interface FrontMatter {
  context: Record<string, string>;
}

/**
 * Parse YAML front matter from a markdown file.
 * Supports the simple key: value format used in gate prompt files.
 * Returns null if no front matter block found.
 */
export function parseFrontMatter(content: string): { frontMatter: FrontMatter; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;

  const yamlBlock = match[1];
  const body = match[2];

  // Parse the context block: look for `context:` followed by indented key: value lines
  const contextMatch = yamlBlock.match(/context:\s*\n((?:[ \t]+\S[^\n]*\n?)*)/);
  const context: Record<string, string> = {};

  if (contextMatch) {
    const contextLines = contextMatch[1].split("\n");
    for (const line of contextLines) {
      const kvMatch = line.match(/^\s+(\w+):\s*["']?(.*?)["']?\s*$/);
      if (kvMatch) {
        context[kvMatch[1]] = kvMatch[2];
      }
    }
  }

  return { frontMatter: { context }, body };
}

// ── Token resolution ──────────────────────────────────────────────────────────

const BUILTIN_TOKENS = new Set(["TICKET_ID", "PHASE", "TICKET_TITLE", "BRANCH", "WORKTREE"]);

/**
 * Replace ${TOKEN} expressions in a string using a context map.
 * Unknown ALL_CAPS tokens are substituted with an empty string (with a warning).
 * lowercase/mixed tokens are left unresolved (returned as-is).
 */
export function resolveTokenExpressions(
  text: string,
  ctx: Record<string, string>,
): string {
  return text.replace(/\$\{([^}]+)\}/g, (match, expr: string) => {
    const name = expr.trim();
    if (name in ctx) return ctx[name];
    // ALL_CAPS unknown: substitute empty (warn on stderr)
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
      process.stderr.write(`[evaluate-gate] Warning: Unknown token \${${name}} — substituting empty string\n`);
      return "";
    }
    // lowercase/mixed: leave unresolved for LLM to handle
    return match;
  });
}

/**
 * Resolve a gate prompt file:
 * 1. Parse YAML front matter to find file-path context variables
 * 2. Substitute ${TICKET_ID} in the path values
 * 3. Read each referenced file and build a context map (name → content)
 * 4. Replace ${VAR} tokens in the prompt body with file contents + built-ins
 */
export function resolveGatePrompt(
  promptPath: string,
  ticketId: string,
  repoRoot: string,
): string {
  const raw = readFileSync(promptPath, "utf-8");
  const parsed = parseFrontMatter(raw);

  const builtins: Record<string, string> = { TICKET_ID: ticketId };

  if (!parsed) {
    // No front matter — just resolve built-in tokens in the body
    return resolveTokenExpressions(raw, builtins);
  }

  const { frontMatter, body } = parsed;

  // Build context: resolve each path variable and read file content
  const ctx: Record<string, string> = { ...builtins };

  for (const [varName, rawPath] of Object.entries(frontMatter.context)) {
    // Resolve ${TICKET_ID} in the path itself
    const resolvedPath = rawPath.replace(/\$\{TICKET_ID\}/g, ticketId);
    const absPath = join(repoRoot, resolvedPath);

    if (existsSync(absPath)) {
      ctx[varName] = readFileSync(absPath, "utf-8").trimEnd();
    } else {
      // File not found: substitute a placeholder so the LLM knows
      process.stderr.write(`[evaluate-gate] Warning: Context file not found: ${absPath}\n`);
      ctx[varName] = `[File not found: ${resolvedPath}]`;
    }
  }

  return resolveTokenExpressions(body, ctx);
}

// ── Gate lookup ───────────────────────────────────────────────────────────────

/**
 * Get a gate config from the pipeline. Returns null if not found.
 */
export function getGateConfig(pipeline: any, gateName: string): Record<string, any> | null {
  return (pipeline?.gates?.[gateName] as Record<string, any>) ?? null;
}

/**
 * Extract the list of valid keywords from a gate config (keys of gate.on).
 */
export function getValidKeywords(gate: Record<string, any>): string[] {
  const on = gate.on as Record<string, unknown> | undefined;
  return on ? Object.keys(on) : [];
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "evaluate-gate.ts");

  if (args.length < 2) {
    console.error(JSON.stringify({
      error: "Usage: evaluate-gate.ts <TICKET_ID> <GATE_NAME> [--verdict <KEYWORD>]",
    }));
    process.exit(1);
  }

  const ticketId = args[0];
  const gateName = args[1];

  // Parse --verdict flag
  let verdict: string | undefined;
  const verdictIdx = args.indexOf("--verdict");
  if (verdictIdx !== -1) {
    verdict = args[verdictIdx + 1];
    if (!verdict) {
      console.error(JSON.stringify({ error: "--verdict requires a keyword argument" }));
      process.exit(1);
    }
  }

  const repoRoot = getRepoRoot();
  const { pipeline } = loadPipelineForTicket(repoRoot, ticketId);

  const gate = getGateConfig(pipeline, gateName);
  if (!gate) {
    console.error(JSON.stringify({
      error: `Gate '${gateName}' not found in pipeline config`,
      availableGates: Object.keys(pipeline?.gates ?? {}),
    }));
    process.exit(3);
  }

  const validKeywords = getValidKeywords(gate);

  // ── Mode 2: Verdict validation ────────────────────────────────────────────

  if (verdict !== undefined) {
    if (!validKeywords.includes(verdict)) {
      console.error(JSON.stringify({
        error: `Invalid verdict keyword '${verdict}' for gate '${gateName}'`,
        validKeywords,
      }));
      process.exit(2);
    }

    const response = (gate.on as Record<string, unknown>)[verdict];
    console.log(JSON.stringify({ keyword: verdict, response }));
    return;
  }

  // ── Mode 1: Prompt resolution ─────────────────────────────────────────────

  const promptFile = gate.prompt as string | undefined;
  if (!promptFile) {
    // Gate has no prompt file — return empty prompt with valid keywords
    console.log(JSON.stringify({ prompt: "", validKeywords }));
    return;
  }

  const promptPath = join(repoRoot, promptFile);
  if (!existsSync(promptPath)) {
    console.error(JSON.stringify({
      error: `Gate prompt file not found: ${promptPath}`,
      gateName,
    }));
    process.exit(3);
  }

  const resolved = resolveGatePrompt(promptPath, ticketId, repoRoot);
  console.log(JSON.stringify({ prompt: resolved, validKeywords }));
}

if (import.meta.main) {
  main();
}
