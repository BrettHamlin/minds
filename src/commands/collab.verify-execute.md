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
> - `VERIFY_EXECUTE_COMPLETE` — all verification checks pass
> - `VERIFY_EXECUTE_FAILED` — one or more checks failed
> - `VERIFY_EXECUTE_ERROR` — ticket spec missing, config error, or unrecoverable failure
>
> Signal is emitted via `bun .collab/handlers/emit-verify-execute-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] VERIFY_EXECUTE_COMPLETE | detail text`
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
bun .collab/handlers/emit-verify-execute-signal.ts error "No ticket ID provided"
```

### 2. Read Verification Checklist

Read the ticket spec from `specs/*/spec.md` or the Linear ticket description. Extract the verification checklist — these are the concrete steps to execute.

If no spec or checklist found, emit error:
```bash
bun .collab/handlers/emit-verify-execute-signal.ts error "No verification checklist found in ticket spec"
```

### 3. Execute Checks Sequentially

For each check in the checklist, execute the appropriate action:

**Shell commands** (`bun test`, `npx vitest run`, `wrangler d1 execute`):
- Run the command and capture stdout/stderr
- Pass: exit code 0
- Fail: non-zero exit code

**HTTP calls** (`curl` to local dev or preview URL):
- Make the request and capture response status + body
- Pass: expected HTTP status (usually 200/201)
- Fail: unexpected status or connection error

**Database state checks**:
- Query the database and verify expected state
- Pass: expected rows/tables exist
- Fail: missing or incorrect data

**Playwright browser flows** (if needed):
- Use the Browser skill for visual/interactive checks
- Pass: expected elements visible and functional
- Fail: elements missing or broken

Record evidence per check: command output, response body, screenshot.

### 4. Produce Structured Report

Format results as:

```
VERIFY_EXECUTE REPORT — {TICKET_ID}
Environment: {base_url or context}

PASSED ({pass_count}/{total_count}):
  ✓ {check description} — {evidence summary}

FAILED ({fail_count}/{total_count}):
  ✗ {check description}
    → Error: {error message}
    → Command: {command that was run}
    → Output: {relevant output}

Result: {PASSED|FAILED} — {summary}
```

### 5. Emit Signal

**All checks pass:**
```bash
bun .collab/handlers/emit-verify-execute-signal.ts pass "All {total} checks passed"
```

**Any check fails:**
```bash
bun .collab/handlers/emit-verify-execute-signal.ts fail "{fail_count} of {total} checks failed"
```

### 6. On VERIFY_EXECUTE_FAILED — Remediation

When verification fails, the orchestrator sends the structured failure report back to the agent pane. The agent reviews failures, fixes the underlying issues, and re-runs this command.

The self-loop is managed by the pipeline config (`VERIFY_EXECUTE_FAILED → verify_execute`).

## Design Rationale

This command follows the proven `collab.run-tests` pattern:
- **Deterministic signals** via explicit handler calls (not hooks)
- **Structured evidence** — every check has captured output
- **Project-agnostic** — reads checklist from ticket spec, no hardcoded checks
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
