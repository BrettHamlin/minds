/**
 * Memory Mind — per-Mind memory provisioning, search, write, and hygiene.
 *
 * Owns: paths, provision, write, index, search, hygiene for all Mind memory dirs.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "@minds/server-base.js";
import type { WorkUnit, WorkResult } from "@minds/mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "provision mind memory": {
      const { provisionMind } = await import("./lib/provision.js");
      const mindName = ctx.mindName as string | undefined;
      if (!mindName) {
        return { status: "handled", error: "provision mind memory: missing context.mindName" };
      }
      const result = await provisionMind(mindName);
      return { status: "handled", result };
    }

    case "provision all minds memory": {
      const { provisionAllMinds } = await import("./lib/provision.js");
      const mindsDir = ctx.mindsDir as string | undefined;
      const result = await provisionAllMinds(mindsDir);
      return { status: "handled", result };
    }

    case "search memory": {
      const { searchMemory } = await import("./lib/search.js");
      const mindName = ctx.mindName as string | undefined;
      const query = ctx.query as string | undefined;
      if (!mindName || !query) {
        return { status: "handled", error: "search memory: missing context.mindName or context.query" };
      }
      const opts = ctx.opts as Record<string, unknown> | undefined;
      const results = await searchMemory(mindName, query, opts as any);
      return { status: "handled", result: { results } };
    }

    case "append daily log": {
      const { appendDailyLog } = await import("./lib/write.js");
      const mindName = ctx.mindName as string | undefined;
      const content = ctx.content as string | undefined;
      if (!mindName || !content) {
        return { status: "handled", error: "append daily log: missing context.mindName or context.content" };
      }
      const date = ctx.date as string | undefined;
      await appendDailyLog(mindName, content, date);
      return { status: "handled", result: { ok: true } };
    }

    case "update memory md": {
      const { updateMemoryMd } = await import("./lib/write.js");
      const mindName = ctx.mindName as string | undefined;
      const content = ctx.content as string | undefined;
      if (!mindName || !content) {
        return { status: "handled", error: "update memory md: missing context.mindName or context.content" };
      }
      await updateMemoryMd(mindName, content);
      return { status: "handled", result: { ok: true } };
    }

    case "sync index": {
      const { syncIndex } = await import("./lib/index.js");
      const mindName = ctx.mindName as string | undefined;
      if (!mindName) {
        return { status: "handled", error: "sync index: missing context.mindName" };
      }
      await syncIndex(mindName);
      return { status: "handled", result: { ok: true } };
    }

    case "promote to memory md": {
      const { promoteToMemoryMd } = await import("./lib/hygiene.js");
      const mindName = ctx.mindName as string | undefined;
      const entries = ctx.entries as string[] | undefined;
      if (!mindName || !entries) {
        return { status: "handled", error: "promote to memory md: missing context.mindName or context.entries" };
      }
      await promoteToMemoryMd(mindName, entries);
      return { status: "handled", result: { ok: true } };
    }

    case "prune stale entries": {
      const { pruneStaleEntries } = await import("./lib/hygiene.js");
      const mindName = ctx.mindName as string | undefined;
      if (!mindName) {
        return { status: "handled", error: "prune stale entries: missing context.mindName" };
      }
      await pruneStaleEntries(mindName);
      return { status: "handled", result: { ok: true } };
    }

    case "warm session": {
      const { warmSession } = await import("./lib/index.js");
      const mindName = ctx.mindName as string | undefined;
      if (!mindName) {
        return { status: "handled", error: "warm session: missing context.mindName" };
      }
      await warmSession(mindName);
      return { status: "handled", result: { ok: true } };
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "memory",
  domain: "Per-Mind memory provisioning, daily log writes, curated MEMORY.md updates, SQLite-backed FTS5 search indexing, and hygiene (promotion + pruning). Owns all memory directories for all Minds.",
  keywords: ["memory", "provision", "search", "index", "hygiene", "daily log", "MEMORY.md", "FTS5", "BM25", "vector"],
  owns_files: ["minds/memory/"],
  capabilities: [
    "provision mind memory",
    "provision all minds memory",
    "search memory",
    "append daily log",
    "update memory md",
    "sync index",
    "promote to memory md",
    "prune stale entries",
    "warm session",
  ],
  exposes: [
    "memoryDir",
    "memoryMdPath",
    "dailyLogPath",
    "provisionMind",
    "provisionAllMinds",
    "appendDailyLog",
    "updateMemoryMd",
    "createIndex",
    "syncIndex",
    "warmSession",
    "searchMemory",
    "promoteToMemoryMd",
    "pruneStaleEntries",
  ],
  consumes: [],
  handle,
});
