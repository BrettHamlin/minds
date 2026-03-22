---
description: Generate Mind-aware tasks for collab development. Decomposes work along Mind boundaries — each task stays within one Mind's domain. Cross-Mind work becomes separate tasks with interface contracts.
---

> **IMPORTANT:** Execute this command directly. Do NOT wrap in PAI Algorithm phases.

> **NEVER ask interactive questions.** If prior work exists for the ticket (commits, partial implementations), the CLI handles it. Always proceed autonomously.

## Step 1: Fetch ticket from Linear

Use the Linear MCP tool to fetch the ticket. Extract the fields the CLI needs and write them to `specs/<TICKET>/ticket.json`.

```
Ticket ID: $ARGUMENTS
```

1. Call the Linear `get_issue` tool with the ticket ID from $ARGUMENTS
2. Create the specs directory if needed: `mkdir -p specs/<TICKET_ID>`
3. Write `specs/<TICKET_ID>/ticket.json` with this exact structure:
```json
{
  "title": "<issue title>",
  "description": "<full issue description text>",
  "labels": ["<label1>", "<label2>"],
  "project": "<project name or null>"
}
```

**Use the raw description text from Linear — do NOT summarize, truncate, or rewrite it.**

## Step 2: Run the tasks CLI

```bash
if [ -f .minds/cli/bin/minds.ts ]; then
  bun .minds/cli/bin/minds.ts tasks $ARGUMENTS
else
  bun minds/cli/bin/minds.ts tasks $ARGUMENTS
fi
```

**After the command finishes, report the output and STOP.** Do NOT retry or re-run.
