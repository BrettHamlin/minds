---
description: Verification checklist executor — reads ticket spec, executes checks, emits structured pass/fail signal.
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-245)

## Orchestrator Signal Contract (ALWAYS ACTIVE)

> Before this command completes, it MUST emit exactly one signal:
> - completion signal — all verification checks pass
> - failure signal — one or more checks failed
> - error signal — ticket spec missing, config error, or unrecoverable failure
>
> Signal is emitted via `bun .collab/handlers/emit-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] {PHASE}_COMPLETE | detail text`
>
> Signal MUST be written to signal-queue file BEFORE tmux send-keys (pipeline persistence contract).

## Goal

Execute a verification checklist from the ticket spec. Instead of writing code, this command reads the ticket description, extracts verification steps, runs each check in sequence, and produces a structured pass/fail report.

## Execution Steps

### 1. Validate Input

Parse arguments to extract:
- `ticket_id` (required)

If no ticket ID provided, emit error signal and exit:
```bash
bun .collab/handlers/emit-signal.ts error "No ticket ID provided"
```

### Step 0: Extract Checklist (Agent-Driven)

1. Read `specs/*/spec.md` (or Linear ticket AC)
2. For each verification item, classify as deterministic or agent-driven
3. Write structured checklist to `.collab/config/verify-checklist.json`
   - Deterministic checks go in `checks[]`: `file_exists`, `file_contains`, `http_200`, `command_succeeds`, `json_field`
   - Agent checks go in `agentChecks[]`: anything requiring browser, DB, or complex logic

### Step 1: Deterministic Checks (Executor)

Call the deterministic verification executor. This script reads `.collab/config/verify-checklist.json`, executes each check by type, and prints a verdict line to stdout.

```bash
bun .collab/scripts/verify-execute-executor.ts --cwd <worktree-path> 2>&1
```

Capture:
- The **last line** of stdout — verdict in format `VERIFY_EXECUTE_COMPLETE | detail` or `VERIFY_EXECUTE_FAILED | detail` or `VERIFY_EXECUTE_ERROR | detail`
- The **exit code**: `0` = pass, `1` = fail, `2` = error

Do NOT duplicate executor logic inline — config reading, file checks, HTTP calls, command execution, and JSON field checks are all handled by the executor.

**Exit 2 — Emit error signal and STOP:**
```bash
bun .collab/handlers/emit-signal.ts error "${verdict_detail}"
```

**Exit 1 — Emit failure signal and STOP:**
```bash
bun .collab/handlers/emit-signal.ts fail "${verdict_detail}"
```

**Exit 0 — All deterministic checks passed. Proceed to Step 2.**

### Step 2: Agent-Driven Checks

Only reached when Step 1 passes (exit 0). Read `agentChecks` from the config — these are checks the executor cannot handle:
1. Execute each using appropriate tools (Browser skill, DB client, etc.)
2. If any fail → emit failure signal with details
3. If all pass → emit completion signal

```bash
bun .collab/handlers/emit-signal.ts pass "All checks passed"
```

### On failure — Remediation

When verification fails, the orchestrator sends the structured failure report back to the agent pane. The agent reviews failures, fixes the underlying issues, and re-runs this command.

The self-loop is managed by the pipeline config (fail transition → `verify_execute`).

## Design Rationale

This command follows the proven `collab.deploy-verify` two-layer pattern:
- **Layer 1 (deterministic)** — executor handles file, HTTP, command, JSON checks
- **Layer 2 (agent-driven)** — agent handles Playwright, DB, complex logic
- **Structured evidence** — every check has captured output
- **Project-agnostic** — reads checklist from agent-generated config
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
