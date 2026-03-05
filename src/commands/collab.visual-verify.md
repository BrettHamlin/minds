---
description: General-purpose browser visual verification — reads config, checks structural DOM + visual diff, emits pass/fail signal.
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-349)

## Orchestrator Signal Contract (ALWAYS ACTIVE)

> Before this command completes, it MUST emit exactly one signal:
> - completion signal — all structural and visual checks pass
> - failure signal — structural failure or visual diff exceeds threshold
> - error signal — config missing, dev server failed, Playwright missing
>
> Signal is emitted via `bun .collab/handlers/emit-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] {PHASE}_COMPLETE | detail text`
>
> Signal MUST be written to signal-queue file BEFORE tmux send-keys (pipeline persistence contract).

## Goal

Verify a web frontend against structural DOM expectations and reference screenshots. Reads configuration from `.collab/config/visual-verify.json`, starts the dev server if configured, runs two-layer verification (structural + visual diff), and emits a pass/fail signal.

## Execution Steps

### 1. Validate Input

Parse arguments to extract:
- `ticket_id` (required)

If no ticket ID provided, emit error signal and exit:
```bash
bun .collab/handlers/emit-signal.ts error "No ticket ID provided"
```

### 2. Start Dev Server (if configured)

Read `.collab/config/visual-verify.json`. If `startCommand` is configured, start the dev server as a background process BEFORE calling the executor. Poll `baseUrl + readyPath` until it returns HTTP 200 (up to `readyTimeout` seconds).

If the server fails to start or times out, emit error:
```bash
bun .collab/handlers/emit-signal.ts error "Dev server failed to start within 30s"
```

### 3. Layer 1 — Deterministic Structural Checks (Executor)

Call the deterministic visual verify executor. This script reads `.collab/config/visual-verify.json`, fetches each configured route, checks DOM selectors, and prints a single verdict line to stdout.

```bash
bun .collab/scripts/visual-verify-executor.ts --cwd <worktree-path> 2>&1
```

Capture:
- The **last line** of stdout — verdict in format `VISUAL_VERIFY_COMPLETE | detail` or `VISUAL_VERIFY_FAILED | detail` or `VISUAL_VERIFY_ERROR | detail`
- The **exit code**: `0` = pass, `1` = fail, `2` = error

Do NOT duplicate executor logic inline — config validation, route fetching, and selector checking are all handled by the executor.

**Exit 2 — Emit `VISUAL_VERIFY_ERROR` and STOP:**
```bash
bun .collab/handlers/emit-signal.ts error "${verdict_detail}"
```

**Exit 1 — Emit `VISUAL_VERIFY_FAILED` and STOP:**
```bash
bun .collab/handlers/emit-signal.ts fail "${verdict_detail}"
```

**Exit 0 — Structural checks passed. Proceed to Layer 2.**

### 4. Layer 2 — Agent-Driven Visual Diff (Playwright)

Only reached when Layer 1 passes (exit 0). For routes with reference screenshots in the configured `referenceDir`:
1. Navigate to each route with Playwright
2. Use `toHaveScreenshot()` with `mask` for dynamic regions
3. If diff exceeds `maxDiffPixelRatio`, record failure

If any visual diff exceeds threshold, emit failure:
```bash
bun .collab/handlers/emit-signal.ts fail "Visual diff: ${details}"
```

### 5. Emit Success Signal

If both Layer 1 and Layer 2 pass:
```bash
bun .collab/handlers/emit-signal.ts pass "All structural and visual checks passed"
```

### 6. On VISUAL_VERIFY_FAILED — Remediation

When verification fails, the orchestrator sends the structured failure report back to the agent pane. The agent fixes the code and re-runs this command.

Retry loop is managed by the orchestrator (max 3 attempts).

## Design Rationale

This command follows the proven `collab.run-tests` pattern:
- **Deterministic signals** via explicit handler calls (not hooks)
- **Two-layer verification** — structural DOM checks + visual pixel diff
- **Project-agnostic** — configured per-project via visual-verify.json
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
