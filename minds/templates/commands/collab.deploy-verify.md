---
description: Post-deploy smoke verification — polls production URL, runs smoke routes, emits pass/fail signal.
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-245)

## Orchestrator Signal Contract (ALWAYS ACTIVE)

> Before this command completes, it MUST emit exactly one signal:
> - completion signal — all smoke routes pass
> - failure signal — one or more routes failed or timeout exceeded
> - error signal — config missing, Playwright failed to launch, or unrecoverable failure
>
> Signal is emitted via `bun .gravitas/handlers/emit-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] {PHASE}_COMPLETE | detail text`
>
> Signal MUST be written to signal-queue file BEFORE tmux send-keys (pipeline persistence contract).

## Goal

Run post-deploy smoke verification against the live production URL to confirm the deployment succeeded. Reads configuration from `.gravitas/config/deploy-verify.json`, polls until the production URL responds, then verifies all configured smoke routes.

## Execution Steps

### 1. Validate Input

Parse arguments to extract:
- `ticket_id` (required)

If no ticket ID provided, emit error signal and exit:
```bash
bun .gravitas/handlers/emit-signal.ts error "No ticket ID provided"
```

### 2. Layer 1 — Deterministic HTTP Smoke Checks (Executor)

Call the deterministic deploy verify executor. This script reads `.gravitas/config/deploy-verify.json`, polls the production URL until it responds, then checks each smoke route for HTTP 200 and response time.

```bash
bun .gravitas/scripts/deploy-verify-executor.ts --cwd <worktree-path> 2>&1
```

Capture:
- The **last line** of stdout — verdict in format `DEPLOY_VERIFY_COMPLETE | detail` or `DEPLOY_VERIFY_FAILED | detail` or `DEPLOY_VERIFY_ERROR | detail`
- The **exit code**: `0` = pass, `1` = fail, `2` = error

Do NOT duplicate executor logic inline — config reading, URL polling, route checking, and response time capture are all handled by the executor.

**Exit 2 — Emit error signal and STOP:**
```bash
bun .gravitas/handlers/emit-signal.ts error "${verdict_detail}"
```

**Exit 1 — Emit failure signal and STOP:**
```bash
bun .gravitas/handlers/emit-signal.ts fail "${verdict_detail}"
```

**Exit 0 — HTTP smoke checks passed. Proceed to Layer 2.**

### 3. Layer 2 — Agent-Driven Browser Checks (Optional)

Only reached when Layer 1 passes (exit 0). For each smoke route:
1. Navigate to `productionUrl + route` using the Browser skill (Playwright)
2. Check for console errors and JS exceptions on the page
3. Capture screenshots for visual confirmation

If any Browser-based issues found, emit failure:
```bash
bun .gravitas/handlers/emit-signal.ts fail "Browser: ${details}"
```

### 4. Emit Success Signal

If both Layer 1 and Layer 2 pass:
```bash
bun .gravitas/handlers/emit-signal.ts pass "All smoke routes healthy"
```

### 5. On failure — Remediation

When verification fails, the orchestrator routes to the next phase per pipeline config (typically `deploy_human_gate` which presents fix-forward / rollback / investigate options via AskUserQuestion).

## Design Rationale

This command follows the proven `gravitas.verify-execute` pattern:
- **Deterministic signals** via explicit handler calls (not hooks)
- **Polling with timeout** — handles async deploy propagation
- **Browser-based verification** — captures JS errors, not just HTTP status
- **Project-agnostic** — configured per-project via deploy-verify.json
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
