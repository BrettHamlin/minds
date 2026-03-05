---
description: General-purpose test suite executor — reads config, runs tests, emits pass/fail signal with full output.
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-350)

## Orchestrator Signal Contract (ALWAYS ACTIVE)

> Before this command completes, it MUST emit exactly one signal:
> - completion signal — all tests pass (exit code 0)
> - failure signal — tests fail (exit code non-zero), includes test output
> - error signal — command failed to execute (missing binary, config error)
>
> Signal is emitted via `bun .collab/handlers/emit-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] {PHASE}_COMPLETE | detail text`
>
> Signal MUST be written to signal-queue file BEFORE tmux send-keys (pipeline persistence contract).

## Goal

Execute the project's test suite as configured in `.collab/config/run-tests.json`, capture full stdout/stderr output, and emit a pass/fail signal. Works with any test runner — no runner-specific logic.

## Execution Steps

### 1. Validate Input

Parse arguments to extract:
- `ticket_id` (required)

If no ticket ID provided, emit error signal and exit:
```bash
bun .collab/handlers/emit-signal.ts error "No ticket ID provided"
```

### 2. Run Test Executor

Call the deterministic test executor script. This script reads `.collab/config/run-tests.json`, executes the configured test command, and prints a single verdict line to stdout.

```bash
bun .collab/scripts/run-tests-executor.ts --cwd <worktree-path> 2>&1
```

Capture:
- The **last line** of stdout — this is the verdict in format `RUN_TESTS_COMPLETE | detail` or `RUN_TESTS_FAILED | detail` or `RUN_TESTS_ERROR | detail`
- The **exit code**: `0` = pass, `1` = fail, `2` = error

Do NOT duplicate executor logic inline — config reading, command execution, timeout handling, and required file checking are all handled by the executor.

### 3. Map Result and Emit Signal

Based on the executor exit code, emit the corresponding pipeline signal:

**Exit 0 — Tests Pass:**
```bash
bun .collab/handlers/emit-signal.ts pass "All tests passed"
```

**Exit 1 — Tests Fail:**
```bash
bun .collab/handlers/emit-signal.ts fail "${verdict_detail}"
```

Include the verdict detail from the executor's last stdout line in the signal.

**Exit 2 — Execution Error:**
```bash
bun .collab/handlers/emit-signal.ts error "${verdict_detail}"
```

### 4. On RUN_TESTS_FAILED — Remediation

When tests fail, the orchestrator will send the full test output back to the agent pane as a remediation prompt. The agent fixes the code and re-runs this command.

Retry loop is managed by the orchestrator (max 3 attempts), same pattern as codeReview retry.

## Design Rationale

This command follows the proven `collab.blindqa` pattern:
- **Deterministic signals** via explicit handler calls (not hooks)
- **Orchestration boundary** separated from test execution
- **Runner-agnostic** — works with vitest, jest, bun test, pytest, go test, cargo test, etc.
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
