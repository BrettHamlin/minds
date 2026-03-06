/**
 * Integrations Mind — external service adapters (Slack, and future Discord/Teams).
 *
 * All adapters communicate outward via HTTP/SDK — no direct imports into other Minds.
 * SpecAPI still calls Slack via dynamic import during Wave B → Wave C refactor.
 *
 * Leaf Mind: no children, no discoverChildren().
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const req = workUnit.request.toLowerCase().trim();
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  // "post message" — post a message to a Slack channel
  if (req.startsWith("post message")) {
    const { postQuestionToChannel } = await import("./slack/interactions.js");
    const { channelId, question, progress } = ctx as {
      channelId: string;
      question: { id: string; text: string; options: string[]; specId: string };
      progress: { current: number; total: number };
    };
    if (!channelId || !question) {
      return { status: "handled", error: "Missing context.channelId or context.question" };
    }
    await postQuestionToChannel(channelId, question, progress);
    return { status: "handled", result: { ok: true } };
  }

  // "create channel" — create a Slack channel
  if (req.startsWith("create channel")) {
    const { slackApp } = await import("./slack/client.js");
    const name = (ctx.name as string | undefined);
    if (!name) {
      return { status: "handled", error: "Missing context.name for channel creation" };
    }
    const result = await slackApp.client.conversations.create({ name });
    return { status: "handled", result: { channelId: result.channel?.id, name: result.channel?.name } };
  }

  // "get user info" — look up a Slack user by ID
  if (req.startsWith("get user info")) {
    const { slackApp } = await import("./slack/client.js");
    const userId = (ctx.userId as string | undefined);
    if (!userId) {
      return { status: "handled", error: "Missing context.userId" };
    }
    const info = await slackApp.client.users.info({ user: userId });
    return { status: "handled", result: { user: info.user } };
  }

  return { status: "escalate" };
}

export default createMind({
  name: "integrations",
  domain: "External service adapters: Slack (and future Discord, Teams). Handles messaging, channel management, and user lookups.",
  keywords: ["slack", "integration", "channel", "message", "post", "user", "notify", "discord", "teams"],
  owns_files: ["minds/integrations/"],
  capabilities: [
    "post message to Slack channel",
    "create Slack channel",
    "get Slack user info",
  ],
  handle,
});
