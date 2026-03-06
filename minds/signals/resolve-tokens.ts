#!/usr/bin/env bun
/**
 * resolve-tokens.ts — Pipeline v3.1 token expression resolver
 *
 * Usage: bun resolve-tokens.ts "<template>" '<context-json>'
 *
 * Tiers:
 *   Tier 1 — Seven built-in variables substituted directly from context JSON
 *   Tier 2 — ALL_CAPS unknown tokens: warn to stderr, substitute empty string
 *   Tier 3 — lowercase/mixed expressions: return unresolved (AI handles inline)
 *
 * Built-in Tier 1 tokens:
 *   ${TICKET_ID}, ${TICKET_TITLE}, ${PHASE}, ${INCOMING_SIGNAL},
 *   ${INCOMING_DETAIL}, ${BRANCH}, ${WORKTREE}
 */

const TIER1_KEYS = new Set([
  "TICKET_ID",
  "TICKET_TITLE",
  "PHASE",
  "INCOMING_SIGNAL",
  "INCOMING_DETAIL",
  "BRANCH",
  "WORKTREE",
]);

const template = process.argv[2] ?? "";
const contextArg = process.argv[3] ?? "{}";

let context: Record<string, string> = {};
try {
  context = JSON.parse(contextArg);
} catch {
  process.stderr.write(
    `Warning: Invalid context JSON: ${contextArg.slice(0, 100)}\n`
  );
}

function resolveTokens(tmpl: string, ctx: Record<string, string>): string {
  return tmpl.replace(/\$\{([^}]+)\}/g, (match, expr: string) => {
    const trimmed = expr.trim();

    // Tier 1: Built-in known variables
    if (TIER1_KEYS.has(trimmed)) {
      return ctx[trimmed] ?? "";
    }

    // Tier 2: ALL_CAPS unknown (warn + empty)
    if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) {
      process.stderr.write(
        `Warning: Unknown token \${${trimmed}} — substituting empty string\n`
      );
      return "";
    }

    // Tier 3: lowercase/mixed — return unresolved for AI inline evaluation
    return match;
  });
}

const resolved = resolveTokens(template, context);
process.stdout.write(resolved);
