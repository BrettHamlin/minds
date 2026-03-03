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
> - `RUN_TESTS_COMPLETE` — all tests pass (exit code 0)
> - `RUN_TESTS_FAILED` — tests fail (exit code non-zero), includes test output
> - `RUN_TESTS_ERROR` — command failed to execute (missing binary, config error)
>
> Signal is emitted via `bun .collab/handlers/emit-run-tests-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] RUN_TESTS_COMPLETE | detail text`
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
bun .collab/handlers/emit-run-tests-signal.ts error "No ticket ID provided"
```

### 2. Read Test Configuration

Read `.collab/config/run-tests.json`:

```json
{
  "command": "npx vitest run",
  "workingDir": ".",
  "timeout": 120,
  "requiredTestFiles": []
}
```

Fields:
- `command` (required) — the test command to execute
- `workingDir` (optional, default `.`) — working directory for test execution
- `timeout` (optional, default 120) — max seconds before killing the test process
- `requiredTestFiles` (optional) — specific test files that must be run and pass

If config file is missing or malformed, emit error:
```bash
bun .collab/handlers/emit-run-tests-signal.ts error "Config file .collab/config/run-tests.json not found or malformed"
```

### 3. Execute Test Command

Run the configured command in the configured working directory:

```bash
cd "${workingDir}" && timeout ${timeout}s ${command} 2>&1
```

Capture:
- Full stdout + stderr combined output
- Exit code

### 4. Check Required Test Files (if configured)

If `requiredTestFiles` is set and non-empty, verify each listed file appears in the test output. This confirms the specific files were actually run.

If any required file is missing from output, treat as failure.

### 5. Evaluate Result and Emit Signal

**Case A: Tests Pass (exit code 0, all required files verified)**
```bash
bun .collab/handlers/emit-run-tests-signal.ts pass "All tests passed"
```

**Case B: Tests Fail (exit code non-zero)**
```bash
bun .collab/handlers/emit-run-tests-signal.ts fail "Tests failed: ${truncated_output}"
```

Include the full test output in the signal detail (truncated to 200 chars by the handler).

**Case C: Command Error (command not found, timeout, config error)**
```bash
bun .collab/handlers/emit-run-tests-signal.ts error "Test command failed to execute: ${error_message}"
```

### 6. On RUN_TESTS_FAILED — Remediation

When tests fail, the orchestrator will send the full test output back to the agent pane as a remediation prompt. The agent fixes the code and re-runs this command.

Retry loop is managed by the orchestrator (max 3 attempts), same pattern as codeReview retry.

## Design Rationale

This command follows the proven `collab.blindqa` pattern:
- **Deterministic signals** via explicit handler calls (not hooks)
- **Orchestration boundary** separated from test execution
- **Runner-agnostic** — works with vitest, jest, bun test, pytest, go test, cargo test, etc.
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
