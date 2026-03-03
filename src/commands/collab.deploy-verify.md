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
> - `DEPLOY_VERIFY_COMPLETE` — all smoke routes pass
> - `DEPLOY_VERIFY_FAILED` — one or more routes failed or timeout exceeded
> - `DEPLOY_VERIFY_ERROR` — config missing, Playwright failed to launch, or unrecoverable failure
>
> Signal is emitted via `bun .collab/handlers/emit-deploy-verify-signal.ts <pass|fail|error> "detail"`.
> Signal format: `[SIGNAL:TICKET_ID:NONCE] DEPLOY_VERIFY_COMPLETE | detail text`
>
> Signal MUST be written to signal-queue file BEFORE tmux send-keys (pipeline persistence contract).

## Goal

Run post-deploy smoke verification against the live production URL to confirm the deployment succeeded. Reads configuration from `.collab/config/deploy-verify.json`, polls until the production URL responds, then verifies all configured smoke routes.

## Execution Steps

### 1. Validate Input

Parse arguments to extract:
- `ticket_id` (required)

If no ticket ID provided, emit error signal and exit:
```bash
bun .collab/handlers/emit-deploy-verify-signal.ts error "No ticket ID provided"
```

### 2. Read Deploy Verification Config

Read `.collab/config/deploy-verify.json`:

```json
{
  "productionUrl": "https://paper-clips.net",
  "smokeRoutes": ["/", "/briefing", "/auth/login"],
  "pollIntervalSeconds": 15,
  "maxWaitSeconds": 300
}
```

Fields:
- `productionUrl` (required) — base URL of the production deployment
- `smokeRoutes` (required) — routes to verify after deploy
- `pollIntervalSeconds` (optional, default 15) — interval between readiness polls
- `maxWaitSeconds` (optional, default 300) — max wait for production to respond

If config file is missing or malformed, emit error:
```bash
bun .collab/handlers/emit-deploy-verify-signal.ts error "Config file .collab/config/deploy-verify.json not found"
```

### 3. Poll Production URL

Poll `productionUrl` at the configured interval until it returns HTTP 200 (CF Pages deploys can take 1-2 minutes).

If timeout exceeded:
```bash
bun .collab/handlers/emit-deploy-verify-signal.ts fail "Production URL did not respond within {maxWaitSeconds}s"
```

### 4. Run Smoke Routes

For each route in `smokeRoutes`:
1. Navigate to `productionUrl + route` using the Browser skill (Playwright)
2. Verify HTTP status is 200
3. Check for console errors on the page
4. Capture evidence (screenshot, response status)

Collect all failures.

### 5. Emit Signal

**All routes pass:**
```bash
bun .collab/handlers/emit-deploy-verify-signal.ts pass "All {total} smoke routes passed"
```

**Any route fails:**
```bash
bun .collab/handlers/emit-deploy-verify-signal.ts fail "{fail_count} of {total} routes failed: {route_list}"
```

### 6. On DEPLOY_VERIFY_FAILED — Remediation

When verification fails, the orchestrator routes to the next phase per pipeline config (typically `deploy_human_gate` which presents fix-forward / rollback / investigate options via AskUserQuestion).

## Design Rationale

This command follows the proven `collab.verify-execute` pattern:
- **Deterministic signals** via explicit handler calls (not hooks)
- **Polling with timeout** — handles async deploy propagation
- **Browser-based verification** — captures JS errors, not just HTTP status
- **Project-agnostic** — configured per-project via deploy-verify.json
- **Signal contract** documented and versioned independently
- **Pipeline persistence** — signal written to queue before tmux send
