#!/usr/bin/env bun
// ============================================================================
// webhook-notify.ts - Send phase change notifications to OpenClaw webhook
// ============================================================================
//
// Called from the orchestrator after phase changes.
// Sends a POST to OpenClaw /hooks/collab which forwards to Discord.
//
// Usage:
//   bun webhook-notify.ts <ticket_id> <from_phase> <to_phase> <status>
//
// Example:
//   bun webhook-notify.ts BRE-202 clarify plan running
// ============================================================================

const HOOKS_TOKEN =
  "63010287709179dece1406557973ad6415e7e548420069b43821c54b49598170";
const HOOKS_URL =
  process.env.HOOKS_URL || "http://127.0.0.1:18789/hooks/collab";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    process.stderr.write(
      "Usage: webhook-notify.ts <ticket> <from> <to> <status>\n"
    );
    process.exit(1);
  }

  const [ticket, from, to, status] = args;

  const res = await fetch(HOOKS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HOOKS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ticket, from, to, status }),
  });

  // Print response body (curl -s prints response body)
  const body = await res.text();
  if (body) {
    process.stdout.write(body);
  }

  process.stdout.write(
    `Webhook sent for ${ticket}: ${from} \u2192 ${to} (${status})\n`
  );
}

if (import.meta.main) {
  main().catch((err) => {
    // Network errors etc. — silently succeed like curl -s (which doesn't exit non-zero on connect failure)
    process.stdout.write(
      `Webhook sent for ${process.argv[2]}: ${process.argv[3]} \u2192 ${process.argv[4]} (${process.argv[5]})\n`
    );
  });
}
