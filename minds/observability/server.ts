/**
 * Observability Mind — metrics, run classification, draft PR, gate accuracy,
 * autonomy rate, dashboard, and statusline.
 *
 * Owns: metrics.ts, autonomy-rate.ts, classify-run-lib.ts, dashboard-lib.ts,
 * draft-pr-lib.ts, gate-accuracy-lib.ts, statusline.ts, and the system-node
 * CLIs: record-gate, create-draft-pr, complete-run, classify-run,
 * metrics-dashboard, gate-accuracy-check.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "@minds/server-base.js";
import type { WorkUnit, WorkResult } from "@minds/mind.js";
import { metricsDbPath } from "@minds/shared/paths.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "evaluate gate":
    case "record gate result": {
      const { openMetricsDb, insertGate } = await import("./metrics.js");
      const repoRoot = ctx.repoRoot as string | undefined;
      const ticketId = ctx.ticketId as string | undefined;
      const gateName = ctx.gateName as string | undefined;
      const decision = ctx.decision as string | undefined;
      const reasoning = ctx.reasoning as string | null | undefined;
      if (!repoRoot || !ticketId || !gateName || !decision) {
        return { status: "handled", error: "Missing context: repoRoot, ticketId, gateName, decision" };
      }
      const db = openMetricsDb(metricsDbPath());
      const id = insertGate(db, ticketId, gateName, decision, reasoning ?? null);
      db.close();
      return { status: "handled", result: { ticketId, gate: gateName, decision, id } };
    }

    case "create draft pr": {
      const { createDraftPr } = await import("./draft-pr-lib.js");
      const repoRoot = ctx.repoRoot as string | undefined;
      const branch = ctx.branch as string | undefined;
      const ticketId = ctx.ticketId as string | undefined;
      if (!repoRoot || !branch || !ticketId) {
        return { status: "handled", error: "Missing context: repoRoot, branch, ticketId" };
      }
      const result = await createDraftPr(branch, ticketId);
      return { status: "handled", result };
    }

    case "complete run": {
      const { openMetricsDb, completeRun } = await import("./metrics.js");
      const repoRoot = ctx.repoRoot as string | undefined;
      const ticketId = ctx.ticketId as string | undefined;
      const outcome = ctx.outcome as string | undefined;
      if (!repoRoot || !ticketId || !outcome) {
        return { status: "handled", error: "Missing context: repoRoot, ticketId, outcome" };
      }
      const db = openMetricsDb(metricsDbPath());
      completeRun(db, ticketId, outcome);
      db.close();
      return { status: "handled", result: { ticketId, outcome } };
    }

    case "classify run": {
      const { openMetricsDb } = await import("./metrics.js");
      const { classifyRun } = await import("./classify-run-lib.js");
      const { getAllAutonomyRates } = await import("./autonomy-rate.js");
      const repoRoot = ctx.repoRoot as string | undefined;
      const ticketId = ctx.ticketId as string | undefined;
      if (!repoRoot || !ticketId) {
        return { status: "handled", error: "Missing context: repoRoot, ticketId" };
      }
      const db = openMetricsDb(metricsDbPath());
      const result = classifyRun(db, ticketId);
      const rates = getAllAutonomyRates(db);
      db.close();
      return { status: "handled", result: { ...result, autonomyRates: rates } };
    }

    case "log observability metrics":
    case "view pipeline metrics":
    case "show dashboard": {
      const { openMetricsDb } = await import("./metrics.js");
      const repoRoot = ctx.repoRoot as string | undefined;
      const last = (ctx.last as number | undefined) ?? 10;
      if (!repoRoot) {
        return { status: "handled", error: "Missing context.repoRoot" };
      }
      const db = openMetricsDb(metricsDbPath());
      const { listRuns: listRunsFn } = await import("./dashboard-lib.js");
      const runs = listRunsFn(db, { last });
      db.close();
      return { status: "handled", result: { runs } };
    }

    case "check gate accuracy": {
      const { openMetricsDb } = await import("./metrics.js");
      const { updateGateAccuracy, getGateAccuracyReport } = await import("./gate-accuracy-lib.js");
      const repoRoot = ctx.repoRoot as string | undefined;
      const ticketId = ctx.ticketId as string | undefined;
      if (!repoRoot || !ticketId) {
        return { status: "handled", error: "Missing context: repoRoot, ticketId" };
      }
      const db = openMetricsDb(metricsDbPath());
      updateGateAccuracy(db, ticketId);
      const report = getGateAccuracyReport(db);
      db.close();
      return { status: "handled", result: report };
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "observability",
  domain: "Metrics, run classification, draft PR, gate accuracy, autonomy rate, dashboard, and statusline.",
  keywords: ["metrics", "gate", "accuracy", "dashboard", "autonomy", "classify", "run", "pr", "statusline", "observability"],
  owns_files: ["minds/observability/"],
  capabilities: [
    "record gate result",
    "create draft pr",
    "complete run",
    "classify run",
    "show dashboard",
    "check gate accuracy",
    "log observability metrics",
    "evaluate gate",
    "view pipeline metrics",
  ],
  exposes: [
    "record gate result",
    "create draft pr",
    "complete run",
    "classify run",
    "show dashboard",
    "check gate accuracy",
  ],
  consumes: [
    "pipeline_core/getRepoRoot",
    "pipeline_core/validateTicketIdArg",
    "pipeline_core/readJsonFile",
  ],
  handle,
});
