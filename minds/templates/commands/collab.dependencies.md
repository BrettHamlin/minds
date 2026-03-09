---
description: Analyze cross-repo dependencies for multi-repo ticket sets and write coordination.json files.
---

# Dependency Analyzer

You are the **dependency analyzer**. Your job is to determine cross-repo dependencies between tickets in a multi-repo orchestration session, then write `coordination.json` files for tickets that need to wait on others.

## Arguments

`$ARGUMENTS` = space-separated ticket IDs (e.g., `BRE-100 BRE-101 BRE-102`)

---

## Step 1: Locate artifacts

For each ticket in `$ARGUMENTS`:

1. Find the ticket's spec directory: scan `specs/*/metadata.json` for `ticket_id` match.
2. Read `plan.md` and `tasks.md` from `specs/{feature-name}/` (or worktree equivalent).
3. Record: `{ ticket_id, repo_id, plan_summary, task_list }` for each ticket.

---

## Step 2: Determine dependencies (AI judgment)

Read all plans and task lists. For each pair of tickets, evaluate:

- Does ticket A produce an output (API, schema, data model, file) that ticket B consumes?
- Does ticket A need to complete a phase before ticket B can start its implementation?
- Are there shared resources or breaking changes that impose ordering?

This is **pure AI judgment** — no scripts. Use your understanding of the codebase, the plans, and the ticket descriptions.

---

## Step 3: Write coordination.json

For any ticket that must wait for another, write `specs/{feature-name}/coordination.json`:

```json
{
  "wait_for": [
    { "ticket_id": "BRE-100", "phase": "implement" }
  ]
}
```

- `ticket_id`: the ticket this one depends on
- `phase`: the phase that must complete before this ticket can proceed

Only write `coordination.json` for tickets with real dependencies. Tickets with no dependencies need no file.

---

## Step 4: Emit signal

```
[SIGNAL:{first_ticket_id}:{nonce}] DEPENDENCY_COMPLETE | Analyzed {N} tickets; {M} dependencies written
```

Where:
- `first_ticket_id` = the first ticket from `$ARGUMENTS`
- `nonce` = read from registry: `REGISTRY=$(bun .collab/scripts/orchestrator/resolve-path.ts {first_ticket_id} registry) && jq -r '.nonce' "$REGISTRY"`
- `N` = total ticket count
- `M` = number of coordination.json files written

---

## Rules

1. **Only write coordination.json where a real ordering dependency exists.** False positives stall pipelines unnecessarily.
2. **Phase granularity matters.** If ticket B only needs ticket A's `plan` phase (not full implementation), write `"phase": "plan"`.
3. **Symmetric dependencies are cycles.** If A must wait for B AND B must wait for A, that is an error — report it instead of writing both files.
4. **Emit signal at the end.** The orchestrator is waiting for DEPENDENCY_COMPLETE to proceed.
