#!/usr/bin/env bun

/**
 * resolve-tickets.ts — Classify raw collab.run arguments into ticket IDs and project names.
 *
 * This CLI is a PURE argument classifier. It does NOT call the Linear API.
 * All Linear resolution (project → tickets, ticket → labels) is handled by
 * the agent via MCP tools, which already have authenticated access.
 *
 * Usage:
 *   bun resolve-tickets.ts BRE-342:default BRE-341:mobile
 *   bun resolve-tickets.ts "Collab Install"
 *   bun resolve-tickets.ts "Collab Install" BRE-999:custom
 *
 * Output (stdout): JSON object with classified arguments:
 *   {
 *     "ticketsWithVariant": [{"ticket": "BRE-342", "variant": "backend"}],
 *     "ticketsNoVariant": ["BRE-339"],
 *     "projectNames": ["Collab Install"]
 *   }
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error (no arguments)
 */

/** Matches BRE-123 or BRE-123:variant — the ticket ID pattern. */
const TICKET_RE = /^([A-Z]+-\d+)(?::(\w+))?$/;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ClassifiedArgs {
  /** Tickets with explicit variant (e.g. BRE-342:backend) — no Linear lookup needed */
  ticketsWithVariant: { ticket: string; variant: string }[];
  /** Bare ticket IDs (e.g. BRE-339) — agent resolves variant via MCP get_issue labels */
  ticketsNoVariant: string[];
  /** Project names — agent resolves to tickets via MCP list_issues */
  projectNames: string[];
}

// ---------------------------------------------------------------------------
// Label → variant resolution (exported for use by agent or other scripts)
// ---------------------------------------------------------------------------

/** Scan label names for "pipeline:<variant>" and return the variant suffix, or "default". */
export function resolvePipelineVariant(labels: string[]): string {
  for (const label of labels) {
    const m = label.match(/^pipeline:(\w+)$/i);
    if (m) return m[1];
  }
  return "default";
}

// ---------------------------------------------------------------------------
// Argument classification
// ---------------------------------------------------------------------------

export function classifyArgs(args: string[]): ClassifiedArgs {
  const ticketsWithVariant: { ticket: string; variant: string }[] = [];
  const ticketsNoVariant: string[] = [];
  const projectNames: string[] = [];

  for (const arg of args) {
    const m = arg.match(TICKET_RE);
    if (m) {
      if (m[2]) {
        ticketsWithVariant.push({ ticket: m[1], variant: m[2] });
      } else {
        ticketsNoVariant.push(m[1]);
      }
    } else {
      projectNames.push(arg);
    }
  }

  return { ticketsWithVariant, ticketsNoVariant, projectNames };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    process.stderr.write(
      'Usage: resolve-tickets.ts [BRE-123[:variant]] ["Project Name"] ...\n' +
        "\n" +
        "Classifies arguments into ticket IDs and project names.\n" +
        "Linear API resolution is handled by the agent via MCP tools.\n"
    );
    process.exit(1);
  }

  const result = classifyArgs(args);
  process.stdout.write(JSON.stringify(result) + "\n");
}

if (import.meta.main) {
  main();
}
