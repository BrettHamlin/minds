#!/usr/bin/env bun

/**
 * metrics-dashboard.ts — Read-only pipeline run dashboard CLI
 *
 * Queries metrics.db and displays pipeline run data with optional filters.
 * All flags compose freely; --json switches any view to structured output.
 *
 * Usage:
 *   bun metrics-dashboard.ts [options]
 *
 * Options:
 *   --last N             Show last N runs (default: 10)
 *   --phase <name>       Filter by phase name
 *   --outcome <s|f>      Filter by outcome: success | failure
 *   --gates              Show gate accuracy stats
 *   --autonomy           Show autonomy rate (3 windows)
 *   --quality            Show PR/code quality outcomes
 *   --json               Output structured JSON
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 *   2 = runtime error
 */

import { Database } from "bun:sqlite";
// TODO(WD): getRepoRoot should be requested via parent escalation once Pipeline Core is a Mind.
import { getRepoRoot } from "../pipeline_core/repo"; // CROSS-MIND
import { openMetricsDb } from "./metrics";
import {
  listRuns,
  getBottleneckPhases,
  getQualityStats,
} from "./dashboard-lib";
import { getGateAccuracyReport } from "./gate-accuracy-lib";
import { getAllAutonomyRates } from "./autonomy-rate";

// ============================================================================
// Arg parsing
// ============================================================================

interface CliOptions {
  last: number;
  phase: string | null;
  outcome: "success" | "failure" | null;
  gates: boolean;
  autonomy: boolean;
  quality: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions | null {
  const opts: CliOptions = {
    last: 10,
    phase: null,
    outcome: null,
    gates: false,
    autonomy: false,
    quality: false,
    json: false,
  };

  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--last") {
      const raw = args[++i];
      const n = parseInt(raw ?? "", 10);
      if (isNaN(n) || n < 1) {
        console.error("Error: --last requires a positive integer");
        return null;
      }
      opts.last = n;
    } else if (arg === "--phase") {
      const val = args[++i];
      if (!val) {
        console.error("Error: --phase requires a value");
        return null;
      }
      opts.phase = val;
    } else if (arg === "--outcome") {
      const val = args[++i];
      if (val !== "success" && val !== "failure") {
        console.error("Error: --outcome must be 'success' or 'failure'");
        return null;
      }
      opts.outcome = val;
    } else if (arg === "--gates") {
      opts.gates = true;
    } else if (arg === "--autonomy") {
      opts.autonomy = true;
    } else if (arg === "--quality") {
      opts.quality = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else {
      console.error(`Error: Unknown option: ${arg}`);
      return null;
    }
    i++;
  }

  return opts;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmtDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function fmtPct(rate: number | null): string {
  if (rate === null) return "-";
  return `${(rate * 100).toFixed(0)}%`;
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const header = headers.map((h, i) => h.padEnd(widths[i])).join(" | ");
  const sep = widths.map((w) => "-".repeat(w)).join("-+-");
  console.log(header);
  console.log(sep);
  for (const row of rows) {
    console.log(row.map((c, i) => (c ?? "").padEnd(widths[i])).join(" | "));
  }
}

// ============================================================================
// Views
// ============================================================================

function runRunsView(db: Database, opts: CliOptions): void {
  const runs = listRuns(db, {
    last: opts.last,
    phase: opts.phase ?? undefined,
    outcome: opts.outcome ?? undefined,
  });
  const bottlenecks = getBottleneckPhases(db, 5);

  if (opts.json) {
    console.log(JSON.stringify({ runs, bottlenecks }));
    return;
  }

  if (runs.length === 0) {
    console.log("No runs found.");
    return;
  }

  console.log(`\nLast ${runs.length} run(s):\n`);
  printTable(
    ["Ticket", "Started", "Duration", "Phases", "Outcome", "Auto", "Interventions"],
    runs.map((r) => [
      r.ticketId,
      r.startedAt.replace("T", " ").slice(0, 16),
      fmtDuration(r.durationMs),
      String(r.phaseCount),
      r.outcome ?? "-",
      r.autonomous === 1 ? "yes" : r.autonomous === 0 ? "no" : "-",
      String(r.interventionCount),
    ])
  );

  if (bottlenecks.length > 0) {
    console.log("\nBottleneck phases (avg duration):\n");
    printTable(
      ["Phase", "Avg Duration", "Runs"],
      bottlenecks.map((b) => [b.phase, fmtDuration(b.avgDurationMs), String(b.count)])
    );
  }
}

function runGatesView(db: Database, opts: CliOptions): void {
  const report = getGateAccuracyReport(db);

  if (opts.json) {
    console.log(JSON.stringify({ gates: report }));
    return;
  }

  if (report.length === 0) {
    console.log("No gate data found.");
    return;
  }

  console.log("\nGate accuracy stats:\n");
  printTable(
    ["Gate", "Total", "Pass", "Fail", "TPR", "FPR"],
    report.map((g) => [
      g.gate,
      String(g.totalDecisions),
      String(g.passCount),
      String(g.failCount),
      fmtPct(g.truePositiveRate),
      fmtPct(g.falsePositiveRate),
    ])
  );
}

function runAutonomyView(db: Database, opts: CliOptions): void {
  const rates = getAllAutonomyRates(db);

  if (opts.json) {
    console.log(JSON.stringify({ autonomy: rates }));
    return;
  }

  console.log("\nAutonomy rate:\n");
  printTable(
    ["Window", "Rate", "Autonomous", "Total"],
    rates.map((r) => [
      r.window,
      fmtPct(r.rate),
      String(r.autonomous),
      String(r.total),
    ])
  );
}

function runQualityView(db: Database, opts: CliOptions): void {
  const stats = getQualityStats(db);

  if (opts.json) {
    console.log(JSON.stringify({ quality: stats }));
    return;
  }

  console.log(`\nCode quality / PR outcomes:\n`);
  console.log(`  Total runs:   ${stats.totalRuns}`);
  console.log(`  Runs with PR: ${stats.runsWithPr}`);

  if (stats.prs.length === 0) {
    console.log("\nNo PRs found.");
    return;
  }

  console.log("");
  printTable(
    ["Ticket", "PR #", "Branch", "URL"],
    stats.prs.map((p) => [
      p.ticketId,
      String(p.prNumber),
      p.prBranch ?? "-",
      p.prUrl,
    ])
  );
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const opts = parseArgs(process.argv);
  if (!opts) {
    process.exit(1);
  }

  const repoRoot = getRepoRoot();

  try {
    const dbPath = `${repoRoot}/.collab/state/metrics.db`;
    const db = openMetricsDb(dbPath);

    if (opts.gates) {
      runGatesView(db, opts);
    } else if (opts.autonomy) {
      runAutonomyView(db, opts);
    } else if (opts.quality) {
      runQualityView(db, opts);
    } else {
      runRunsView(db, opts);
    }

    db.close();
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${String(err)}`);
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
