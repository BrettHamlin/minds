---
description: Run E2E tests for this repo. Supports mind filter (--mind @label) and visual screenshot comparison (--visual).
---

> **IMPORTANT:** Execute these steps directly and sequentially. Do NOT wrap this workflow in PAI Algorithm phases, ISC criteria, capability selection, or any other meta-framework. Follow the numbered steps exactly as written.

## Arguments

```text
$ARGUMENTS
```

Supported flags:
- `--mind <@label>` — run only tests registered for a specific mind (e.g. `--mind @blueprint-api`)
- `--visual` — after tests pass, take screenshots and analyze visually

## Step 1: Parse Arguments

Extract from `$ARGUMENTS`:
- `MIND_FILTER` — value after `--mind` (include the `@` prefix), or empty string if not given
- `VISUAL_MODE` — `true` if `--visual` is present, `false` otherwise

## Step 2: Read Registry

Read `tests/e2e/registry.json`. Expected schema:

```json
{
  "tests": [
    { "mind": "@label", "file": "tests/e2e/path/to/test.ts" }
  ]
}
```

If the file does not exist, stop and report:

```
No E2E test registry found at tests/e2e/registry.json.
Run the scaffolding command to create it, or create it manually.
```

Parse the `tests` array. If `MIND_FILTER` is non-empty, keep only entries where `mind === MIND_FILTER`. If no entries match, stop and report:

```
No tests registered for ${MIND_FILTER} in tests/e2e/registry.json.
```

## Step 3: Start Server

Check if the server is already running:

```bash
curl -s http://localhost:3099/health > /dev/null 2>&1 && echo "running" || echo "stopped"
```

If **stopped**, start the server in a tmux window:

```bash
SERVER_WINDOW="e2e-server-$$"
tmux new-window -n "$SERVER_WINDOW" "cd $PWD && PORT=3099 bun run packages/core/main.ts"
```

Poll for readiness (up to 30 seconds):

```bash
READY=0
for i in $(seq 1 30); do
  curl -s http://localhost:3099/health > /dev/null 2>&1 && READY=1 && break
  sleep 1
done
[ "$READY" -eq 1 ] || { echo "ERROR: Server did not start within 30s"; exit 1; }
```

Track whether you started the server (`SERVER_STARTED=true`) or it was already running (`SERVER_STARTED=false`).

## Step 4: Run Tests

For each entry in the (filtered) test list, run:

```bash
scripts/run-tests.sh <entry.file>
```

Capture the output. Record pass/fail for each file. A file passes if the `FAIL:` count in the output is `0`.

## Step 5: Visual Comparison (only if `--visual`)

If `VISUAL_MODE` is `true` and all tests passed, take a screenshot of the primary app page:

```bash
# Get the first spec ID
SPEC_ID=$(curl -s http://localhost:3099/api/blueprint/specs | bun -e "const d=await Bun.stdin.json(); process.stdout.write(d.specs[0] ?? '')")
[ -n "$SPEC_ID" ] || { echo "No specs found — skipping visual comparison"; exit 0; }

bunx playwright screenshot \
  "http://localhost:3099/blueprint/spec/${SPEC_ID}" \
  /tmp/e2e-visual.png \
  --full-page
```

Read `/tmp/e2e-visual.png` with the image read tool and analyze:
- Are all primary UI sections visible? (attention bar, timeline panel, graph canvas, detail panel)
- Are nodes and edges rendered without layout errors?
- Are labels readable and buttons present?

Note any visual anomalies in the report.

## Step 6: Cleanup

If `SERVER_STARTED` is `true`, stop the server:

```bash
tmux kill-window -t "$SERVER_WINDOW" 2>/dev/null || true
lsof -ti:3099 2>/dev/null | xargs kill -9 2>/dev/null || true
```

Clean up temp files:

```bash
rm -f /tmp/e2e-visual.png
```

## Step 7: Report

Output a structured report:

```
E2E Test Report
═══════════════════════════════════════════
Mind filter:  <MIND_FILTER or "all">
Tests run:    <total count>

RESULTS:
  ✓  tests/e2e/...  (@mind)  — PASS
  ✗  tests/e2e/...  (@mind)  — FAIL
     <failure excerpt>

Summary:  <N> passed, <M> failed

[Visual — only if --visual]
Screenshot: /tmp/e2e-visual.png
Observations: <analysis>
═══════════════════════════════════════════
```

If any tests failed, include the failure output and exit with a non-zero indication so the caller knows the suite did not pass.
