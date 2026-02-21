# Collab Pipeline Architecture

## Overview

The collab pipeline uses a three-layer architecture that separates **what the workflow does** (declarative config) from **how it executes mechanically** (scripts) from **where AI judgment is required** (model instructions).

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Declarative (.collab/config/pipeline.json)          │
│  Defines: phases, commands, transitions, gates, goal gates      │
│  Changes when: workflow evolves (new phases, new transitions)   │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2 — Execution (scripts in .collab/scripts/orchestrator/) │
│  Generic interpreters that read Layer 1 and execute it          │
│  Changes when: pipeline.json SCHEMA changes (rare)             │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3 — Judgment (.claude/commands/collab.run.md)            │
│  AI evaluates gates, chooses answers, escalates                │
│  Changes when: judgment policies change                         │
└─────────────────────────────────────────────────────────────────┘
```

The model's job is **routing and judgment** — not implementing complex logic. Scripts handle all deterministic operations. The model handles all decisions that require contextual reasoning.

---

## Layer 1: Declarative — pipeline.json

`pipeline.json` is the single source of truth for the workflow. It defines:

- **Phases**: what commands run in each phase, what signals each phase can emit
- **Transitions**: which signal from which phase advances to which next phase
- **Gates**: AI judgment checkpoints with response keywords and retry rules
- **Goal gates**: phases that must complete before the pipeline can finish

**Rule: If you want to change the workflow, change pipeline.json.** Do not change scripts or markdown for workflow changes.

### Schema version

Current schema: v3. Validated on startup by `orchestrator-init.sh` using `pipeline.v3.schema.json`.

### Phase definition

```json
{
  "id": "clarify",
  "command": "/collab.clarify",
  "signals": ["CLARIFY_COMPLETE", "CLARIFY_QUESTION", "CLARIFY_ERROR"]
}
```

Or with actions array (for phases that need a display step before the command):

```json
{
  "id": "implement",
  "actions": [
    {"display": "Starting implement phase for {{TICKET_ID}}"},
    {"command": "/collab.implement"}
  ],
  "signals": ["IMPLEMENT_COMPLETE", "IMPLEMENT_ERROR"]
}
```

### Transition definition

```json
{"from": "clarify",  "signal": "CLARIFY_COMPLETE",  "to": "plan"}
{"from": "plan",     "signal": "PLAN_COMPLETE",      "gate": "plan_review"}
{"from": "plan",     "signal": "PLAN_ERROR",         "to": "plan"}
```

### Gate definition

```json
{
  "plan_review": {
    "prompt": ".collab/config/gates/plan.md",
    "responses": {
      "APPROVED": {"to": "tasks"},
      "REVISION_NEEDED": {"to": "plan", "feedback": true, "max_retries": 3}
    },
    "on_exhaust": "skip"
  }
}
```

---

## Layer 2: Execution — Scripts

Scripts are **generic interpreters**. They read their rules from `pipeline.json` and execute them. Changing the pipeline workflow (adding phases, renaming transitions) requires **zero script changes**.

Scripts only need updating when the pipeline.json **schema** changes — new field types, new action types. This is rare architectural work.

### Script inventory

| Script | Purpose | Generic? |
|---|---|---|
| `orchestrator-init.sh` | Validate schema, spawn agent pane, create registry | Yes |
| `phase-dispatch.sh` | Read phase command from pipeline.json, send to agent | Yes |
| `transition-resolve.sh` | Find matching transition row for (phase, signal) | Yes |
| `held-release-scan.sh` | Check held agents, release if dependencies satisfied | Yes |
| `goal-gate-check.sh` | Check phase_history against goal_gate requirements | Yes |
| `signal-validate.sh` | Parse + validate signal format and nonce | Yes |
| `registry-read.sh` | Read ticket registry JSON | Yes |
| `registry-update.sh` | Write ticket registry atomically | Yes |
| `status-table.sh` | Display active pipeline status | Yes |
| `phase-advance.sh` | Look up next phase from pipeline.json | Yes |

### Rule: What belongs in a script

A step belongs in a script if it satisfies **all** of these:
1. The output is deterministic given the inputs (same inputs → same output, always)
2. It reads its rules from a config file, not from hardcoded logic
3. No contextual reasoning is needed (reading and comparing data is not reasoning)

**Test**: Can you write a unit test for this step with fixed inputs and expected outputs? If yes → script. If the expected output depends on understanding context → model.

### phase-dispatch.sh

Dispatches a phase to the agent pane. Handles both `command` shorthand and `actions` arrays. Checks `coordination.json` for hold conditions before dispatching.

```bash
.collab/scripts/orchestrator/phase-dispatch.sh <TICKET_ID> <PHASE_ID>
```

Use this for:
- Initial launch (Step 5 of setup)
- Advancing after `_COMPLETE`
- Retrying after `_ERROR`
- Releasing a held agent

### transition-resolve.sh

Looks up the matching transition for a (phase, signal) pair. Returns `{to, gate, conditional}`.

```bash
.collab/scripts/orchestrator/transition-resolve.sh <CURRENT_PHASE> <SIGNAL_TYPE>
```

If the result has `gate != null`, the model evaluates the gate. If the result has `to != null`, advance directly.

### held-release-scan.sh

Scans all registries for `status=held` agents. For each, checks coordination.json to see if all dependencies are now satisfied. Releases any that are unblocked.

```bash
.collab/scripts/orchestrator/held-release-scan.sh [COMPLETED_TICKET_ID]
```

Call this after every successful phase advance.

### goal-gate-check.sh

Before advancing to the terminal phase, verifies all `goal_gate` requirements. Returns `PASS` or `REDIRECT:<phase_id>`.

```bash
RESULT=$(.collab/scripts/orchestrator/goal-gate-check.sh <TICKET_ID>)
if [[ "$RESULT" == REDIRECT:* ]]; then
  REDIRECT_PHASE="${RESULT#REDIRECT:}"
  # dispatch REDIRECT_PHASE
fi
```

---

## Layer 3: Judgment — collab.run.md

The model's markdown instructions contain **only** steps that require contextual reasoning. Every deterministic step is delegated to a Layer 2 script.

### What stays in the markdown

| Step | Why it requires judgment |
|---|---|
| `_QUESTION` handling | Screen capture, reading options, choosing best answer based on ticket context |
| Gate evaluation | Read gate prompt, evaluate against ticket acceptance criteria, synthesize feedback |
| Escalation decisions | When to give up on retries and involve the human |
| Choosing AskUserQuestion answers | Domain knowledge, project context, best practices |

### What does NOT belong in the markdown

| Step | Why it belongs in a script |
|---|---|
| Phase dispatch | Deterministic: read command from pipeline.json, send to agent |
| Transition lookup | Deterministic: find row matching (from, signal) in transitions[] |
| Held agent scan | Deterministic: compare phase_history entries against coordination.json |
| Goal gate check | Deterministic: count _COMPLETE entries in phase_history by phase |
| Phase history append | Deterministic: write to registry atomically |
| Registry reads/writes | Deterministic: always |

### Rule: What belongs in the markdown

A step belongs in the markdown if it satisfies **any** of these:
1. The correct answer depends on understanding the feature, ticket, or domain (not just data)
2. Different reasonable choices lead to meaningfully different outcomes
3. A wrong choice requires human escalation, not just a retry

---

## Signals

Agents communicate with the orchestrator by printing a signal string:

```
[SIGNAL:{TICKET_ID}:{NONCE}] {SIGNAL_TYPE} | {detail}
```

Example: `[SIGNAL:BRE-233:ab12c] CLARIFY_COMPLETE | All questions answered`

Valid signal types per phase are defined in `pipeline.json` under `phases[].signals`.

The orchestrator validates signals with `signal-validate.sh`, which reads the allowed signals from pipeline.json. **Adding a new signal type requires only a pipeline.json change**, not a script change.

---

## Coordination

Multi-ticket workflows use `coordination.json` to declare dependencies:

```json
{
  "wait_for": [
    {"ticket_id": "BRE-100", "phase": "implement"}
  ]
}
```

Placed at `specs/{TICKET_ID}/coordination.json`. The `phase-dispatch.sh` script checks this before dispatching and sets `status=held` if dependencies are unsatisfied. The `held-release-scan.sh` script releases held agents after each phase completion.

---

## Adding a new phase

1. Add the phase to `pipeline.json` (phases array + transitions)
2. Add a new command file if needed (`.claude/commands/collab.{name}.md`)
3. No script changes required

## Adding a new gate

1. Add the gate definition to `pipeline.json` (gates object)
2. Add the gate's prompt file to `.collab/config/gates/`
3. Add the `gate` field to the relevant transition row
4. No script changes required

## Changing a phase's command

1. Update the `command` field in `pipeline.json`
2. No script changes required
