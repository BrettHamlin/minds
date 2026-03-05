---
description: Pre-deploy confirmation gate — presents deployment summary, waits for explicit user approval before proceeding.
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-245)

## Orchestrator Signal Contract (ALWAYS ACTIVE)

> Before this command completes, it MUST emit exactly one signal:
> - completion signal — user approved the deployment
> - failure signal — user aborted the deployment
> - error signal — spec missing, config error, or unrecoverable failure
>
> Signal is emitted via `bun .collab/handlers/emit-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] {PHASE}_COMPLETE | detail text`
>
> Signal MUST be written to signal-queue file BEFORE tmux send-keys (pipeline persistence contract).

## Goal

Present a structured pre-deploy confirmation gate. This is a human gate that runs before deployment proceeds. It summarizes what will be deployed, presents a checklist of readiness criteria, and waits for explicit user approval.

## Execution

### Step 1: Gather Context (Deterministic)

1. Run: `bun .collab/scripts/pre-deploy-summary.ts --cwd <worktree-path>`
2. If exit 2 → emit PRE_DEPLOY_CONFIRM_ERROR. STOP.
   ```bash
   bun .collab/handlers/emit-signal.ts error "Failed to gather deploy context"
   ```
3. Parse JSON from stdout.

### Step 2: Validate Input

Parse arguments to extract:
- `ticket_id` (required)

If no ticket ID provided, emit error signal and exit:
```bash
bun .collab/handlers/emit-signal.ts error "No ticket ID provided"
```

### Step 3: Present Human Gate (Agent-Driven)

1. Use the JSON context from Step 1 to present a clear `AskUserQuestion`:
   - Show: service, branch, target environment, production URL
   - Show: smoke routes that will be verified post-deploy
   - Show: AC summary, changed files count, test status
   - **Question:** "Pre-deploy confirmation for {TICKET_ID}"
   - **Options:** "Approve — proceed with deploy" / "Abort — stop and investigate"
2. If user approves → emit PRE_DEPLOY_CONFIRM_COMPLETE:
   ```bash
   bun .collab/handlers/emit-signal.ts pass "Deploy approved for {TICKET_ID}"
   ```
3. If user aborts → emit PRE_DEPLOY_CONFIRM_FAILED:
   ```bash
   bun .collab/handlers/emit-signal.ts fail "Deploy aborted by user"
   ```

### Step 4: On PRE_DEPLOY_CONFIRM_FAILED — Pipeline Halts

When the user aborts, the pipeline does not retry automatically. The orchestrator receives the FAILED signal and routes according to the pipeline config (typically back to a review phase or to escalate).

## Design Rationale

This command follows the proven `collab.verify-execute` pattern:
- **Deterministic signals** via explicit handler calls (not hooks)
- **Human gate** — uses AskUserQuestion for explicit approval
- **Idempotent** — re-runnable if the pipeline retries
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
