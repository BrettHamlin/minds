---
description: Self-testing pipeline harness — discovers pipeline infrastructure and runs progressive stage tests using fixture tickets TEST-001 through TEST-005.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). If arguments include a specific stage number (e.g., `stage3`), run only that stage.

## Goal

Validate the collab pipeline infrastructure by spawning sub-pipelines with fixture tickets TEST-001 through TEST-005, each exercising a progressively more complex pipeline configuration. Generate a pass/fail report per stage.

## Execution Steps

### 1. Discover Infrastructure

Scan the pipeline infrastructure and report what's available:

```bash
# Verify orchestrator scripts exist
ls .collab/scripts/orchestrator/commands/ 2>/dev/null | wc -l
ls .collab/config/pipeline-variants/ 2>/dev/null
ls .collab/config/test-fixtures/ 2>/dev/null
```

Check bus transport is available:
```bash
ls .collab/transport/bus-server.ts 2>/dev/null && echo "bus-server: OK" || echo "bus-server: MISSING"
```

Check bus port file (if pipeline is already running):
```bash
cat .collab/bus-port 2>/dev/null && echo "bus: running" || echo "bus: not running"
```

Report findings:
- Pipeline variant configs found
- Test fixture configs found
- Orchestrator scripts present
- Bus transport status

Emit DISCOVER_COMPLETE via signal (only when running inside a pipeline):
```bash
bun .collab/scripts/verify-and-complete.ts discover "Infrastructure discovery complete" 2>/dev/null || true
```

### 2. Stage Configuration

Each stage uses a fixture ticket ID and a minimal pipeline.json loaded from `.collab/config/test-fixtures/stageN.json`.

| Stage | Ticket    | Fixture Config          | What it tests                                    |
|-------|-----------|-------------------------|--------------------------------------------------|
| 1     | TEST-001  | stage1.json             | Terminal-only: orchestrator-init starts/exits    |
| 2     | TEST-002  | stage2.json             | Single phase: signal emission through bus        |
| 3     | TEST-003  | stage3.json             | Two phases: phase transition (clarify→plan→done) |
| 4     | TEST-004  | stage4.json             | Gate evaluation: plan_review gate routing        |
| 5     | TEST-005  | stage5.json             | Full default pipeline: end-to-end                |

### 3. Run Stage Tests

For each stage (or only the requested stage if $ARGUMENTS specifies one):

#### Stage Setup

Copy the fixture config to a temporary pipeline config location for the test:

```bash
STAGE=1
TICKET="TEST-001"
FIXTURE=".collab/config/test-fixtures/stage${STAGE}.json"

# Validate fixture exists
if [ ! -f "$FIXTURE" ]; then
  echo "STAGE ${STAGE} SKIP: fixture not found at $FIXTURE"
fi
```

#### Stage Execution Pattern

For each stage, verify the fixture config is valid JSON:
```bash
bun -e "JSON.parse(require('fs').readFileSync('$FIXTURE','utf8')); console.log('valid')" 2>&1
```

Then report what phase structure would be exercised:
```bash
bun -e "
const cfg = JSON.parse(require('fs').readFileSync('$FIXTURE','utf8'));
const phases = Object.keys(cfg.phases || {});
const gates = Object.keys(cfg.gates || {});
console.log('Phases:', phases.join(' → '));
if (gates.length) console.log('Gates:', gates.join(', '));
console.log('Transport:', cfg.transport);
"
```

#### Stage Validation Criteria

For each stage, evaluate against these criteria:

**Stage 1 (TEST-001 — terminal-only):**
- fixture config loads without error
- `phases` has exactly one key: `done`
- `phases.done.terminal === true`
- transport is `bus`

**Stage 2 (TEST-002 — single phase):**
- fixture config loads without error
- `phases` has `clarify` and `done`
- `clarify` phase has a completion transition to `"done"`
- transport is `bus`

**Stage 3 (TEST-003 — two phases):**
- fixture config loads without error
- `phases` has `clarify`, `plan`, `done`
- clarify transitions to plan, plan transitions to done

**Stage 4 (TEST-004 — gate evaluation):**
- fixture config loads without error
- `phases` has `plan`, `tasks`, `done`
- plan transition uses `gate: "plan_review"`
- gates section defines `plan_review` with APPROVED/REVISION_NEEDED responses

**Stage 5 (TEST-005 — full pipeline):**
- fixture config loads without error
- `phases` has at minimum: `clarify`, `plan`, `tasks`, `analyze`, `implement`, `run_tests`, `blindqa`, `done`
- gates section defines `plan_review`
- transport is `bus`

#### Bus Health Check

If a bus is running (`.collab/bus-port` exists), check its health:
```bash
BUS_PORT=$(cat .collab/bus-port 2>/dev/null)
if [ -n "$BUS_PORT" ]; then
  STATUS=$(curl -sf "http://localhost:${BUS_PORT}/status" 2>/dev/null)
  if [ $? -eq 0 ]; then
    echo "Bus health: OK — $STATUS"
  else
    echo "Bus health: UNREACHABLE (port $BUS_PORT)"
  fi
fi
```

### 4. Report Results

After evaluating all stages, output a structured pass/fail report:

```
╔══════════════════════════════════════════════════════════╗
║           COLLAB PIPELINE SELF-TEST REPORT               ║
╚══════════════════════════════════════════════════════════╝

Stage 1 (TEST-001) — Terminal-only:       [PASS|FAIL] <reason>
Stage 2 (TEST-002) — Single phase:        [PASS|FAIL] <reason>
Stage 3 (TEST-003) — Two phases:          [PASS|FAIL] <reason>
Stage 4 (TEST-004) — Gate evaluation:     [PASS|FAIL] <reason>
Stage 5 (TEST-005) — Full pipeline:       [PASS|FAIL] <reason>

Infrastructure:
  Pipeline variants: <count> found
  Test fixtures:     <count> found
  Orchestrator scripts: <count> found
  Bus transport: <OK|MISSING>

Summary: N/5 stages passed
```

If all 5 stages pass, emit TEST_COMPLETE. If any stage fails, emit TEST_FAILED with the failing stage details.

```bash
# Emit orchestrator signal (only when running inside a pipeline)
PASS_COUNT=<count>
if [ "$PASS_COUNT" -eq 5 ]; then
  bun .collab/scripts/verify-and-complete.ts test "All 5 stages passed" 2>/dev/null || true
else
  # Emit FAILED signal via handler if available
  bun .collab/handlers/emit-signal.ts TEST_FAILED "Stage failures detected: $FAIL_DETAILS" 2>/dev/null || true
fi
```

### 5. Diagnose Failures (when directed by orchestrator)

If the orchestrator routes to diagnose phase, analyze what failed:

1. Re-read each failing stage's fixture config
2. Check if the fixture JSON structure matches the expected schema
3. Check if required phase names exist
4. Check if transition targets are valid phase names (no dangling references)
5. Check if gate names referenced in transitions exist in the `gates` section
6. Report specific field-level issues

Emit DIAGNOSE_COMPLETE when diagnosis is finished:
```bash
bun .collab/scripts/verify-and-complete.ts diagnose "Diagnosis complete" 2>/dev/null || true
```

### 6. Fix Failures (when directed by orchestrator)

Apply targeted fixes to failing fixture configs based on diagnosis:

1. For structural issues: regenerate the fixture JSON from the documented specification above
2. For missing phases: add required phase definitions
3. For dangling transitions: fix the target phase name
4. For missing gates: add the gate definition

Write fixed configs and emit FIX_COMPLETE:
```bash
bun .collab/scripts/verify-and-complete.ts fix "Fixes applied" 2>/dev/null || true
```

### 7. Retest (when directed by orchestrator)

Re-run all stages (or previously failing stages) and emit RETEST_COMPLETE or RETEST_FAILED:
```bash
bun .collab/scripts/verify-and-complete.ts retest "Retest complete" 2>/dev/null || true
```

## Design Notes

- Each stage uses its own bus channel (`pipeline-TEST-001`, `pipeline-TEST-002`, etc.) when running in a full orchestrated context
- Fixture configs are read-only during validation — they are only modified during the fix phase
- The command works standalone (no orchestrator required) — signals are emitted only when the orchestrator environment is active
- Bus /status endpoint (`curl http://localhost:{port}/status`) reports message counts and subscriber counts per channel
