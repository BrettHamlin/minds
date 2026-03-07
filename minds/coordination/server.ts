/**
 * Coordination Mind — dependency holds, group management, batch Q&A,
 * held-release scan, and ticket resolution.
 *
 * Owns: coordination-check, check-dependency-hold, held-release-scan,
 * group-manage, resolve-tickets, write-resolutions, resolve-questions,
 * question-response.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "check coordination": {
      const { buildAdjacency, detectCycles } = await import("./coordination-check.js");
      const ticketIds = ctx.ticketIds as string[] | undefined;
      const specsDir = ctx.specsDir as string | string[] | undefined;
      if (!ticketIds || !specsDir) {
        return { status: "handled", error: "Missing context.ticketIds or context.specsDir" };
      }
      const { adjacency, errors } = buildAdjacency(ticketIds, specsDir);
      if (errors.length > 0) {
        return { status: "handled", result: { ok: false, errors } };
      }
      const cycles = detectCycles(adjacency);
      if (cycles.length > 0) {
        return { status: "handled", result: { ok: false, cycles } };
      }
      return { status: "handled", result: { ok: true } };
    }

    case "check dependency hold": {
      const { checkDependencyHold } = await import("./check-dependency-hold.js");
      const ticketId = ctx.ticketId as string | undefined;
      const repoRoot = ctx.repoRoot as string | undefined;
      if (!ticketId || !repoRoot) {
        return { status: "handled", error: "Missing context.ticketId or context.repoRoot" };
      }
      const result = checkDependencyHold(ticketId, repoRoot);
      return { status: "handled", result };
    }

    case "manage group": {
      const { cmdCreate, cmdAdd, cmdQuery, cmdList } = await import("./group-manage.js");
      const subcommand = ctx.subcommand as string | undefined;
      const repoRoot = ctx.repoRoot as string | undefined;
      const groupsDir = ctx.groupsDir as string | undefined;
      if (!subcommand || !repoRoot || !groupsDir) {
        return { status: "handled", error: "Missing context.subcommand, context.repoRoot, or context.groupsDir" };
      }
      switch (subcommand) {
        case "create": {
          const ticketIds = ctx.ticketIds as string[];
          const group = cmdCreate(ticketIds, repoRoot, groupsDir);
          return { status: "handled", result: group };
        }
        case "add": {
          const groupId = ctx.groupId as string;
          const ticketId = ctx.ticketId as string;
          const group = cmdAdd(groupId, ticketId, repoRoot, groupsDir);
          return { status: "handled", result: group };
        }
        case "query": {
          const ticketId = ctx.ticketId as string;
          const result = cmdQuery(ticketId, repoRoot, groupsDir);
          return { status: "handled", result };
        }
        case "list": {
          const groupId = ctx.groupId as string;
          const result = cmdList(groupId, repoRoot, groupsDir);
          return { status: "handled", result };
        }
        default:
          return { status: "handled", error: `Unknown group subcommand: ${subcommand}` };
      }
    }

    case "resolve questions":
      return { status: "escalate" };

    case "release held tickets": {
      const repoRoot = ctx.repoRoot as string | undefined;
      if (!repoRoot) {
        return { status: "handled", error: "Missing context.repoRoot" };
      }
      return { status: "handled", result: { ok: true, message: "Use held-release-scan CLI for full scan" } };
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "coordination",
  domain: "Dependency holds, group management, batch Q&A, held-release scan, and ticket resolution.",
  keywords: ["coordination", "dependency", "hold", "group", "release", "held", "wait", "resolve", "questions", "batch"],
  owns_files: ["minds/coordination/"],
  capabilities: [
    "check coordination",
    "check dependency hold",
    "manage group",
    "resolve questions",
    "release held tickets",
  ],
  handle,
});
