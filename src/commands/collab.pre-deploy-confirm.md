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
> - `PRE_DEPLOY_CONFIRM_COMPLETE` — user approved the deployment
> - `PRE_DEPLOY_CONFIRM_FAILED` — user aborted the deployment
> - `PRE_DEPLOY_CONFIRM_ERROR` — spec missing, config error, or unrecoverable failure
>
> Signal is emitted via `bun .collab/handlers/emit-pre-deploy-confirm-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] PRE_DEPLOY_CONFIRM_COMPLETE | detail text`
>
> Signal MUST be written to signal-queue file BEFORE tmux send-keys (pipeline persistence contract).

## Goal

Present a structured pre-deploy confirmation gate. This is a human gate that runs before deployment proceeds. It summarizes what will be deployed, presents a checklist of readiness criteria, and waits for explicit user approval.

## Execution Steps

### 1. Validate Input

Parse arguments to extract:
- `ticket_id` (required)

If no ticket ID provided, emit error signal and exit:
```bash
bun .collab/handlers/emit-pre-deploy-confirm-signal.ts error "No ticket ID provided"
```

### 2. Read Deployment Context

Read `specs/*/spec.md` or ticket metadata to identify:
- What is being deployed (service name, repo, branch)
- Target environment (production, staging, preview)
- Deploy mechanism (merge to main, wrangler deploy, etc.)

If no spec found, emit error:
```bash
bun .collab/handlers/emit-pre-deploy-confirm-signal.ts error "No deployment spec found"
```

### 3. Present Confirmation Gate

Use `AskUserQuestion` with a structured prompt:

**Question:** "Pre-deploy confirmation for {TICKET_ID}"
**Context:**
- Summary of what will be deployed
- Target environment and deploy mechanism
- Readiness checklist: staging verified, tests passing, rollback plan known

**Options:**
- `Approve — proceed with deploy`
- `Abort — stop and investigate`

### 4. Emit Signal Based on Response

**User approves:**
```bash
bun .collab/handlers/emit-pre-deploy-confirm-signal.ts pass "Deploy approved for {TICKET_ID}"
```

**User aborts:**
```bash
bun .collab/handlers/emit-pre-deploy-confirm-signal.ts fail "Deploy aborted by user"
```

### 5. On PRE_DEPLOY_CONFIRM_FAILED — Pipeline Halts

When the user aborts, the pipeline does not retry automatically. The orchestrator receives the FAILED signal and routes according to the pipeline config (typically back to a review phase or to escalate).

## Design Rationale

This command follows the proven `collab.verify-execute` pattern:
- **Deterministic signals** via explicit handler calls (not hooks)
- **Human gate** — uses AskUserQuestion for explicit approval
- **Idempotent** — re-runnable if the pipeline retries
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
