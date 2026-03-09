// bus-agent.ts — Bus-aware agent lifecycle utilities (BRE-346)
//
// Provides:
//   generateAgentPrompt  — returns a full curl-based instruction block for
//                          any agent to publish messages to the bus
//   writeAgentMemory     — persists die-and-persist memory JSON
//   readAgentMemory      — restores memory for a resuming agent
//   publishSafe          — fire-and-forget publish that swallows bus errors

import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { mindsRoot } from "../shared/paths.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Standardised message types for all pipeline stages */
export const MSG = {
  STARTED: "started",
  PROGRESS: "progress",
  BLOCKED: "blocked",
  DONE: "done",
  ERROR: "error",
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

/**
 * Die-and-persist memory schema.
 * Written by the agent before exiting so a new session can resume with context.
 */
export interface AgentMemory {
  agent_id: string;
  role: string;
  ticket: string;
  completed_work: string[];
  remaining_work: string[];
  key_decisions: string[];
  worktree_path: string;
  last_updated: string; // ISO 8601
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function curlPublish(busUrl: string, payload: string): string {
  // Build a curl one-liner. The payload is pre-serialised JSON so we single-
  // quote the -d argument and escape any single quotes inside it.
  const escaped = payload.replace(/'/g, "'\\''");
  return (
    `curl -sf -X POST ${busUrl}/publish \\\n` +
    `  -H 'Content-Type: application/json' \\\n` +
    `  -d '${escaped}' || true`
  );
}

function jsonPayload(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

// ── generateAgentPrompt ───────────────────────────────────────────────────────

/**
 * Returns the full bus-communication instruction block to inject into an
 * agent's system prompt.
 *
 * Tells the agent how to:
 *   1. Publish started / progress / blocked / done / error messages via curl
 *   2. Write its die-and-persist memory file before exiting
 *   3. Read that memory file if resuming
 *
 * All curl calls use `|| true` so the agent continues silently if the bus is
 * unavailable.
 */
export function generateAgentPrompt(
  agentId: string,
  busUrl: string,
  channel: string
): string {
  const memPath = `.minds/agents/${agentId}.json`;

  const started = curlPublish(
    busUrl,
    jsonPayload({ channel, from: agentId, type: MSG.STARTED, payload: { agent_id: agentId } })
  );

  const progress = curlPublish(
    busUrl,
    jsonPayload({
      channel,
      from: agentId,
      type: MSG.PROGRESS,
      payload: { agent_id: agentId, message: "<description of completed step>" },
    })
  );

  const blocked = curlPublish(
    busUrl,
    jsonPayload({
      channel,
      from: agentId,
      type: MSG.BLOCKED,
      payload: { agent_id: agentId, reason: "<reason you cannot proceed>" },
    })
  );

  const done = curlPublish(
    busUrl,
    jsonPayload({
      channel,
      from: agentId,
      type: MSG.DONE,
      payload: { agent_id: agentId, memory_path: memPath },
    })
  );

  const error = curlPublish(
    busUrl,
    jsonPayload({
      channel,
      from: agentId,
      type: MSG.ERROR,
      payload: { agent_id: agentId, error: "<error message>" },
    })
  );

  const memoryTemplate = JSON.stringify(
    {
      agent_id: agentId,
      role: "<your role>",
      ticket: "<ticket ID>",
      completed_work: ["<task completed>"],
      remaining_work: ["<task remaining, or empty>"],
      key_decisions: ["<decision made>"],
      worktree_path: "<absolute path to your worktree>",
      last_updated: "<ISO 8601 timestamp>",
    },
    null,
    2
  );

  return [
    `## Bus Communication Protocol`,
    ``,
    `You are agent **${agentId}**. Publish progress to channel \`${channel}\``,
    `via the message bus at ${busUrl}. All curl calls are fire-and-forget —`,
    `\`|| true\` ensures you continue silently if the bus is unavailable.`,
    ``,
    `### Message types`,
    ``,
    `**started** — emit once at the very beginning of your task:`,
    "```bash",
    started,
    "```",
    ``,
    `**progress** — emit periodically as you complete steps:`,
    "```bash",
    progress,
    "```",
    ``,
    `**blocked** — emit if you cannot proceed without help:`,
    "```bash",
    blocked,
    "```",
    ``,
    `**done** — emit when all work is complete. Always include \`agent_id\` and \`memory_path\`:`,
    "```bash",
    done,
    "```",
    ``,
    `**error** — emit on unrecoverable failure:`,
    "```bash",
    error,
    "```",
    ``,
    `### Die-and-persist memory`,
    ``,
    `Before exiting (done **or** error), write your memory file to \`${memPath}\`:`,
    "```json",
    memoryTemplate,
    "```",
    ``,
    `This file is your persistent state. The orchestrator stores your \`agent_id\``,
    `from the done message and will pass it as \`resume: "${agentId}"\` to any`,
    `continuation agent. That agent reads \`${memPath}\` at startup to restore context.`,
    ``,
    `### Resume context`,
    ``,
    `If this session has a resume ID, read \`${memPath}\` immediately at startup`,
    `and use its contents to restore your context before doing any work.`,
  ].join("\n");
}

// ── Memory persistence ────────────────────────────────────────────────────────

function agentsDir(mindsDir: string): string {
  return join(mindsDir, "agents");
}

function memoryPath(agentId: string, mindsDir: string): string {
  return join(agentsDir(mindsDir), `${agentId}.json`);
}

const DEFAULT_MINDS_DIR = mindsRoot();

/**
 * Write the agent's die-and-persist memory file.
 * Creates `.minds/agents/` if it does not exist.
 * Returns the absolute path of the written file.
 */
export function writeAgentMemory(
  agentId: string,
  memory: AgentMemory,
  mindsDir: string = DEFAULT_MINDS_DIR
): string {
  const dir = agentsDir(mindsDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const path = memoryPath(agentId, mindsDir);
  writeFileSync(path, JSON.stringify({ ...memory, last_updated: new Date().toISOString() }, null, 2), "utf8");
  return path;
}

/**
 * Read the agent's memory file.
 * Returns `null` if the file does not exist (fresh start, not resuming).
 */
export function readAgentMemory(
  agentId: string,
  mindsDir: string = DEFAULT_MINDS_DIR
): AgentMemory | null {
  const path = memoryPath(agentId, mindsDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AgentMemory;
  } catch {
    return null;
  }
}

// ── publishSafe ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget publish to the bus.
 * Swallows all errors silently so callers never need to guard against
 * the bus being unavailable.
 */
export async function publishSafe(
  busUrl: string,
  channel: string,
  from: string,
  type: string,
  payload: unknown
): Promise<void> {
  try {
    await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, from, type, payload }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Bus unavailable — silently skip
  }
}
