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
> - `VISUAL_VERIFY_COMPLETE` — all structural and visual checks pass
> - `VISUAL_VERIFY_FAILED` — structural failure or visual diff exceeds threshold
> - `VISUAL_VERIFY_ERROR` — config missing, dev server failed, Playwright missing
>
> Signal is emitted via `bun .collab/handlers/emit-visual-verify-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] VISUAL_VERIFY_COMPLETE | detail text`
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
bun .collab/handlers/emit-visual-verify-signal.ts error "No ticket ID provided"
```

### 2. Read Verification Configuration

Read `.collab/config/visual-verify.json`:

```json
{
  "baseUrl": "http://localhost:3000",
  "startCommand": "bun run dev",
  "readyPath": "/",
  "readyTimeout": 30,
  "routes": [
    { "path": "/", "name": "home", "selectors": [".feed-card", "nav", "footer"] }
  ]
}
```

Fields:
- `baseUrl` (required) — base URL of the dev server
- `startCommand` (optional) — command to start the dev server
- `readyPath` (optional, default `/`) — path to poll for readiness
- `readyTimeout` (optional, default 30) — seconds to wait for server readiness
- `routes` (required) — routes to check with their expected DOM selectors

If config file is missing or malformed, emit error:
```bash
bun .collab/handlers/emit-visual-verify-signal.ts error "Config file .collab/config/visual-verify.json not found"
```

### 3. Start Dev Server (if configured)

If `startCommand` is set, start the dev server as a background process. Poll `baseUrl + readyPath` until it returns HTTP 200 (up to `readyTimeout` seconds).

If the server fails to start or times out, emit error:
```bash
bun .collab/handlers/emit-visual-verify-signal.ts error "Dev server failed to start within 30s"
```

### 4. Layer 1 — Structural Checks

For each route in the config:
1. Fetch `baseUrl + route.path`
2. Verify HTTP status is 200
3. Parse HTML and check each selector in `route.selectors` exists in the DOM

Collect all structural failures. If any exist, emit failure:
```bash
bun .collab/handlers/emit-visual-verify-signal.ts fail "Structural: .feed-card not found on /briefing"
```

### 5. Layer 2 — Visual Diff (when Playwright available)

For routes with reference screenshots in the configured `referenceDir`:
1. Navigate to each route with Playwright
2. Use `toHaveScreenshot()` with `mask` for dynamic regions
3. If diff exceeds `maxDiffPixelRatio`, record failure

If any visual diff exceeds threshold, emit failure with details.

### 6. Emit Success Signal

If all checks pass:
```bash
bun .collab/handlers/emit-visual-verify-signal.ts pass "All structural and visual checks passed"
```

### 7. On VISUAL_VERIFY_FAILED — Remediation

When verification fails, the orchestrator sends the structured failure report back to the agent pane. The agent fixes the code and re-runs this command.

Retry loop is managed by the orchestrator (max 3 attempts).

## Design Rationale

This command follows the proven `collab.run-tests` pattern:
- **Deterministic signals** via explicit handler calls (not hooks)
- **Two-layer verification** — structural DOM checks + visual pixel diff
- **Project-agnostic** — configured per-project via visual-verify.json
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
