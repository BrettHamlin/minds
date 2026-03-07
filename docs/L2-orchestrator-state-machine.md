# L2 -- Orchestrator State Machine

**Last verified**: 2026-02-21
**Source of truth**: `src/config/pipeline.json` (v3.0), `src/commands/collab.run.md`, scripts in `minds/execution/` and `minds/coordination/`

---

## Overview

The collab orchestrator is a signal-driven state machine that manages the lifecycle of feature development tickets through a fixed sequence of phases. It runs as a Claude Code agent in a tmux pane (the "orchestrator pane") and spawns child Claude Code agents in sibling tmux panes (the "agent panes") to execute each phase's work.

The architecture has three layers:

| Layer | Location | Changes when |
|---|---|---|
| **Declarative** | `pipeline.json` | Workflow evolves (new phases, transitions, gates) |
| **Execution** | `minds/execution/*.ts`, `minds/coordination/*.ts` | Pipeline.json schema changes (rare) |
| **Judgment** | `collab.run.md` | Gate evaluation policies change |

All scripts are generic interpreters. They read rules from `pipeline.json` and execute them. Adding, renaming, or reordering phases requires zero script changes.

The orchestrator processes exactly one input per response cycle. It never loops or polls. Inputs are either signals from agent panes or commands from the human operator.

---

## State Machine Diagram (ASCII)

```
                          /collab.specify (pre-orchestration, inline)
                                    |
                                    v
                         +------------------+
                         |  orchestrator-    |
                         |  init.sh          |
                         |  (schema validate |
                         |   coord check     |
                         |   spawn pane      |
                         |   create registry)|
                         +--------+---------+
                                  |
                                  v
    +=========================================================================+
    |                      PIPELINE STATE MACHINE                             |
    |                                                                         |
    |  +----------+     +---------+     +---------+     +----------+          |
    |  | clarify  |---->|  plan   |---->|  tasks  |---->| analyze  |          |
    |  +----------+     +---------+     +---------+     +----------+          |
    |   CLARIFY_       PLAN_COMPLETE    TASKS_COMPLETE   ANALYZE_COMPLETE     |
    |   COMPLETE       --> plan_review  --> analyze      --> analyze_review    |
    |                       gate            (direct)          gate             |
    |   CLARIFY_       +-------+                        +--------+            |
    |   QUESTION       | gate  |                        |  gate  |            |
    |   (answer &      | eval  |                        |  eval  |            |
    |    continue)     +---+---+                        +---+----+            |
    |                      |                                |                 |
    |              APPROVED|REVISION_NEEDED         REMED.  |ESCALATION       |
    |                  |       |                   COMPLETE  |    |            |
    |                  v       v (retry,                |    v    v            |
    |               tasks     plan  max 3)         implement  analyze         |
    |                                                   |   (retry+feedback)  |
    |                                                   v                     |
    |                                            +----------+                 |
    |                                            |implement  |                |
    |                                            +----+------+                |
    |                                                 |                       |
    |                                      IMPLEMENT_COMPLETE                 |
    |                                                 |                       |
    |                                                 v                       |
    |                                          +----------+                   |
    |                                          | blindqa  | <--+              |
    |                                          +----+-----+    |              |
    |                                               |          |              |
    |                                    BLINDQA_COMPLETE  BLINDQA_FAILED     |
    |                                               |      BLINDQA_ERROR      |
    |                                               v     (retry same phase)  |
    |                                      goal-gate-check                    |
    |                                          |        |                     |
    |                                        PASS   REDIRECT:blindqa          |
    |                                          |        |                     |
    |                                          v        +---> blindqa         |
    |                                      +------+                           |
    |                                      | done |                           |
    |                                      +------+                           |
    |                                      (terminal)                         |
    +=========================================================================+

    Error signals (_ERROR) on any phase: retry same phase.
    _QUESTION / _WAITING signals: orchestrator answers, agent continues.
    Coordination holds: phase-dispatch.sh checks coordination.json, may
                        set status=held before dispatching.
```

---

## Pipeline Phases (Detailed)

### Phase: clarify

| Field | Value |
|---|---|
| **id** | `clarify` |
| **command** | `/collab.clarify` |
| **signals** | `CLARIFY_COMPLETE`, `CLARIFY_QUESTION`, `CLARIFY_ERROR` |
| **goal_gate** | none |
| **orchestrator_context** | none |

**What happens**: The agent resolves ambiguities in the feature specification. It reads the spec, identifies unclear requirements, and either resolves them through context or asks the orchestrator.

**Signal routing**:
- `CLARIFY_COMPLETE` --> transition to `plan` (direct)
- `CLARIFY_QUESTION` --> orchestrator answers via tmux send-keys, agent continues
- `CLARIFY_ERROR` --> retry `clarify` (same phase re-dispatch)

---

### Phase: plan

| Field | Value |
|---|---|
| **id** | `plan` |
| **command** | `/collab.plan` |
| **signals** | `PLAN_COMPLETE`, `PLAN_ERROR` |
| **goal_gate** | none |
| **orchestrator_context** | none |

**What happens**: The agent generates an implementation plan based on the specification. Produces `plan.md` in the feature's specs directory.

**Signal routing**:
- `PLAN_COMPLETE` --> gate evaluation: `plan_review`
- `PLAN_ERROR` --> retry `plan` (direct transition back to same phase)

---

### Phase: tasks

| Field | Value |
|---|---|
| **id** | `tasks` |
| **command** | `/collab.tasks` |
| **signals** | `TASKS_COMPLETE`, `TASKS_ERROR` |
| **goal_gate** | none |
| **orchestrator_context** | none |

**What happens**: The agent breaks the plan into a task list. Produces `tasks.md` with checkboxes.

**Signal routing**:
- `TASKS_COMPLETE` --> transition to `analyze` (direct)
- `TASKS_ERROR` --> retry `tasks`

---

### Phase: analyze

| Field | Value |
|---|---|
| **id** | `analyze` |
| **command** | `/collab.analyze` |
| **signals** | `ANALYZE_COMPLETE`, `ANALYZE_ERROR` |
| **goal_gate** | none |
| **orchestrator_context** | none |

**What happens**: The agent cross-references spec, plan, and tasks for consistency. Produces `analysis.md` with a findings table.

**Signal routing**:
- `ANALYZE_COMPLETE` --> gate evaluation: `analyze_review`
- `ANALYZE_ERROR` --> retry `analyze`

---

### Phase: implement

| Field | Value |
|---|---|
| **id** | `implement` |
| **actions** | `[{"display": "Starting implement phase for {{TICKET_ID}}: {{TICKET_TITLE}}"}, {"command": "/collab.implement"}]` |
| **signals** | `IMPLEMENT_COMPLETE`, `IMPLEMENT_WAITING`, `IMPLEMENT_ERROR` |
| **goal_gate** | none |
| **orchestrator_context** | none |

**What happens**: The agent executes the task list, implementing code, tests, and documentation. Uses the actions array pattern: first a `display` action (shown in orchestrator output only, not sent to agent), then the `command` action sent to the agent pane.

**Signal routing**:
- `IMPLEMENT_COMPLETE` --> transition to `blindqa` (direct)
- `IMPLEMENT_WAITING` --> orchestrator answers question via tmux send-keys
- `IMPLEMENT_ERROR` --> retry `implement`

---

### Phase: blindqa

| Field | Value |
|---|---|
| **id** | `blindqa` |
| **actions** | `[{"display": "{{TICKET_ID}} -- Starting Blind QA verification phase"}, {"command": "/collab.blindqa"}]` |
| **signals** | `BLINDQA_COMPLETE`, `BLINDQA_FAILED`, `BLINDQA_ERROR`, `BLINDQA_QUESTION`, `BLINDQA_WAITING` |
| **goal_gate** | `always` |
| **orchestrator_context** | `.collab/config/orchestrator-contexts/blindqa.md` |

**What happens**: An adversarial verification agent tests the implementation without prior knowledge of how it was built. The orchestrator operates in "skeptical overseer mode" (loaded from `blindqa.md` context) -- it challenges success claims and demands concrete evidence before accepting completion.

**Signal routing**:
- `BLINDQA_COMPLETE` --> goal gate check, then transition to `done`
- `BLINDQA_FAILED` --> retry `blindqa`
- `BLINDQA_ERROR` --> retry `blindqa`
- `BLINDQA_QUESTION` --> orchestrator answers via tmux send-keys
- `BLINDQA_WAITING` --> orchestrator answers via tmux send-keys

**Orchestrator context** (`blindqa.md`): Activates skeptical overseer mode. The orchestrator must challenge all success claims, demand concrete artifacts (test output, diffs, command results), and never accept `BLINDQA_COMPLETE` without verification evidence.

---

### Phase: done

| Field | Value |
|---|---|
| **id** | `done` |
| **terminal** | `true` |
| **signals** | (none) |

**What happens**: Pipeline is complete. The registry file is deleted. Status table is updated. Webhook notification sent. If other agents are still running, the orchestrator waits. If none remain, it reports "All pipelines complete."

---

## Gate Evaluation System

Gates are AI judgment checkpoints defined in `pipeline.json` under the `gates` object. When a transition references a `gate` instead of a direct `to`, the orchestrator must evaluate the gate's prompt file, produce exactly one response keyword, and route accordingly.

### plan_review Gate

| Field | Value |
|---|---|
| **prompt** | `.collab/config/gates/plan.md` |
| **responses** | `APPROVED` --> `{"to": "tasks"}`, `REVISION_NEEDED` --> `{"to": "plan", "feedback": true, "max_retries": 3}` |
| **on_exhaust** | `skip` (advance to `tasks` anyway after 3 failed retries) |

**Prompt file** (`gates/plan.md`): Contains YAML front matter with context token declarations:
```yaml
context:
  SPEC_MD: "specs/{{TICKET_ID}}/spec.md"
  PLAN_MD: "specs/{{TICKET_ID}}/plan.md"
```

The orchestrator resolves `{{TOKEN}}` expressions, reads the referenced files, and evaluates the plan against five criteria:
1. Requirements Coverage -- does the plan address all functional requirements?
2. Data Model Completeness -- are all entities and relationships defined?
3. Phase Ordering -- are dependencies correctly ordered?
4. Acceptance Criteria -- do success criteria align?
5. Constitution Compliance -- does the plan comply with constitution.md?

**Response flow**:
- `APPROVED`: advance to `tasks` phase (direct transition)
- `REVISION_NEEDED`: increment `retry_count` in registry, relay full evaluation feedback to the agent, re-dispatch `plan` phase. If `retry_count >= 3`, on_exhaust behavior `skip` advances to `tasks` regardless.

---

### analyze_review Gate

| Field | Value |
|---|---|
| **prompt** | `.collab/config/gates/analyze.md` |
| **responses** | `REMEDIATION_COMPLETE` --> `{"to": "implement"}`, `ESCALATION` --> `{"feedback": true}` |
| **on_exhaust** | `abort` |

**Prompt file** (`gates/analyze.md`): Contains YAML front matter with context token declarations:
```yaml
context:
  SPEC_MD: "specs/{{TICKET_ID}}/spec.md"
  TASKS_MD: "specs/{{TICKET_ID}}/tasks.md"
  ANALYSIS_MD: "specs/{{TICKET_ID}}/analysis.md"
```

**Critical rule**: The verdict must be based solely on the Analysis Report. The orchestrator must NOT substitute its own independent artifact review.

**Evaluation rules**:
- If `ANALYSIS_MD` is missing or contains no findings table: respond `ESCALATION` with instruction to re-run `/collab.analyze`
- If findings exist and have NOT been applied: respond `ESCALATION` with specific finding-by-finding remediation instructions
- If findings exist and ALL have been resolved: respond `REMEDIATION_COMPLETE`
- If report explicitly states zero findings: respond `REMEDIATION_COMPLETE`

**Response flow**:
- `REMEDIATION_COMPLETE`: advance to `implement` phase (direct transition)
- `ESCALATION`: relay feedback to agent, re-dispatch `analyze`. Note: `ESCALATION` has no `to` field and no `max_retries`, which means it retries indefinitely until `on_exhaust: abort` behavior triggers (though without `max_retries` defined on this response, abort requires manual intervention).

---

## Signal Protocol

### Signal Format

```
[SIGNAL:{TICKET_ID}:{NONCE}] {SIGNAL_TYPE} | {DETAIL}
```

Example: `[SIGNAL:BRE-233:ab12c] CLARIFY_COMPLETE | All questions answered`

Components:
- `TICKET_ID`: uppercase letters + hyphen + digits (regex: `[A-Z]+-[0-9]+`)
- `NONCE`: lowercase hex string (regex: `[a-f0-9]+`), generated at registry creation (5 hex chars from `/dev/urandom`)
- `SIGNAL_TYPE`: uppercase letters and underscores (regex: `[A-Z_]+`)
- `DETAIL`: free-form text after the pipe separator

### Validation (signal-validate.ts / signal-validate.sh)

Both Bash and TypeScript implementations exist with identical behavior:

1. **Parse**: regex match against the signal format. Exit 2 on format mismatch.
2. **Registry lookup**: find `{TICKET_ID}.json` in `.collab/state/pipeline-registry/`. Exit 3 if missing.
3. **Nonce validation**: compare signal's nonce against `registry.nonce`. Exit 2 on mismatch.
4. **Phase signal validation**: check that `SIGNAL_TYPE` is in the current phase's `signals` array from `pipeline.json`. Exit 2 if not in allowed list.

**Output on success** (exit 0):
```json
{
  "valid": true,
  "ticket_id": "BRE-233",
  "signal_type": "CLARIFY_COMPLETE",
  "detail": "All questions answered",
  "current_step": "clarify",
  "nonce": "ab12c"
}
```

### Signal Generation (pipeline-signal.ts)

Agent-side signal generation uses `pipeline-signal.ts` shared utilities:
- `resolveRegistry()`: scans registry files matching current `$TMUX_PANE` to find the ticket
- `mapResponseState()`: maps agent response states to signal types (e.g., `"completed"` + `"plan"` --> `"PLAN_COMPLETE"`)
- `buildSignalMessage()`: assembles the formatted signal string
- `truncateDetail()`: caps detail text at 200 characters

### Question/Waiting Signal Detail Encoding

For `_QUESTION` and `_WAITING` signals, the `detail` field encodes the question and all options using the `§` separator:

```
Question text§Option A (Recommended)§Option B§Option C
```

Index 0 = question text, indices 1..N = option labels. The `(Recommended)` tag marks the default choice.

---

## Transition Table

Complete transition rules from `pipeline.json`:

| From | Signal | To | Gate | Notes |
|---|---|---|---|---|
| `clarify` | `CLARIFY_COMPLETE` | `plan` | -- | Direct advance |
| `plan` | `PLAN_COMPLETE` | -- | `plan_review` | AI gate evaluation |
| `plan` | `PLAN_ERROR` | `plan` | -- | Retry same phase |
| `tasks` | `TASKS_COMPLETE` | `analyze` | -- | Direct advance |
| `tasks` | `TASKS_ERROR` | `tasks` | -- | Retry same phase |
| `analyze` | `ANALYZE_COMPLETE` | -- | `analyze_review` | AI gate evaluation |
| `analyze` | `ANALYZE_ERROR` | `analyze` | -- | Retry same phase |
| `implement` | `IMPLEMENT_COMPLETE` | `blindqa` | -- | Direct advance |
| `implement` | `IMPLEMENT_ERROR` | `implement` | -- | Retry same phase |
| `blindqa` | `BLINDQA_COMPLETE` | `done` | -- | Direct advance (after goal gate) |
| `blindqa` | `BLINDQA_FAILED` | `blindqa` | -- | Retry same phase |
| `blindqa` | `BLINDQA_ERROR` | `blindqa` | -- | Retry same phase |

### Transition Resolution Logic (transition-resolve.ts)

Priority rules (FR-014):
1. Rows with an `if` field are evaluated first (conditional) -- first match wins
2. If no conditional row matches, use the first plain row (no `if` field)
3. If no match at all, exit 2

The `--plain` flag skips conditional rows entirely.

Output format:
```json
{"to": "tasks", "gate": null, "if": null, "conditional": false}
```

---

## Registry State Management

### File Location

`.collab/state/pipeline-registry/{TICKET_ID}.json`

One file per active ticket. Deleted on pipeline completion or `[CMD:remove]`.

### JSON Structure

```json
{
  "orchestrator_pane_id": "%0",
  "agent_pane_id": "%3",
  "ticket_id": "BRE-233",
  "nonce": "ab12c",
  "current_step": "clarify",
  "color_index": 1,
  "phase_history": [
    {
      "phase": "clarify",
      "signal": "CLARIFY_COMPLETE",
      "ts": "2026-02-21T12:00:00Z"
    }
  ],
  "started_at": "2026-02-21T11:55:00Z",
  "updated_at": "2026-02-21T12:00:00Z",
  "status": "running",
  "held_at": null,
  "waiting_for": null,
  "group_id": null,
  "retry_count": 0,
  "last_signal": "CLARIFY_COMPLETE",
  "last_signal_at": "2026-02-21T12:00:00Z"
}
```

### Allowed Fields for Update

The `registry-update.ts` and `registry-update.sh` scripts enforce a whitelist:

```
current_step, nonce, status, color_index, group_id, agent_pane_id,
orchestrator_pane_id, worktree_path, last_signal, last_signal_at,
error_count, retry_count, held_at, waiting_for
```

Any field not in this set is rejected with exit 2.

### Atomic Write Protocol

All registry mutations use the tmp+rename pattern:
1. Write to `{TICKET_ID}.json.tmp`
2. Validate the JSON is well-formed
3. `mv` (rename) to `{TICKET_ID}.json`

This prevents partial writes and corruption.

### Phase History Append

The `--append-phase-history` mode adds an entry to the `phase_history` array:
```bash
registry-update.ts BRE-233 --append-phase-history '{"phase":"clarify","signal":"CLARIFY_COMPLETE","ts":"2026-02-21T12:00:00Z"}'
```

Phase history is the authoritative record of what phases completed. It is used by:
- `goal-gate-check.ts`: to verify goal gate requirements
- `held-release-scan.ts`: to check if dependency phases completed
- `coordination-check.sh`: (indirectly) for dependency satisfaction

---

## Coordination System

### Purpose

Coordinates multiple tickets that have dependencies between them. Ticket B can declare it must wait until Ticket A completes a specific phase before Ticket B proceeds past a certain point.

### coordination.json

Per-ticket file at `specs/{TICKET_ID}/coordination.json`. Schema defined in `coordination.schema.json`.

```json
{
  "wait_for": [
    {"id": "BRE-228", "phase": "implement"}
  ]
}
```

Or single dependency (object form, syntactic sugar):
```json
{
  "wait_for": {"id": "BRE-228", "phase": "implement"}
}
```

### Hold Mechanics (phase-dispatch.sh)

Before dispatching any phase, `phase-dispatch.sh` checks for `specs/{TICKET_ID}/coordination.json`:

1. Read `wait_for` entries
2. For each dependency, check the dependency ticket's registry for a `_COMPLETE` entry in `phase_history` matching the required phase
3. If any dependency is unsatisfied:
   - Set `status=held`, `held_at={PHASE_ID}`, `waiting_for={DEP_TICKET}:{DEP_PHASE}`
   - Output `HELD: {TICKET_ID} at {PHASE_ID} -- waiting for {DEP_TICKET}:{DEP_PHASE}`
   - Exit 0 (no dispatch occurs)
4. If all satisfied: proceed with dispatch normally

### Release Mechanics (held-release-scan.ts / held-release-scan.sh)

Called after every successful phase advance (`_COMPLETE` processing):

1. Scan all registry files for `status=held` entries
2. For each held ticket, read its `coordination.json`
3. Check each `wait_for` dependency against the dependency ticket's `phase_history`
4. If all dependencies satisfied: set `status=running`, clear `held_at` and `waiting_for`
5. If still blocked: report which dependency is blocking

Edge cases:
- Held ticket with no `coordination.json`: release with warning
- Held ticket with empty `wait_for`: release with warning

### Coordination Check (coordination-check.sh)

Run during `orchestrator-init.sh` before spawning panes. Validates all coordination files for the current session:

1. **Reference validation**: all `wait_for.id` references must be in the current session's ticket list
2. **Cycle detection**: DFS-based cycle detection to prevent deadlocks (A waits for B, B waits for A)

Input: all ticket IDs as arguments. Exit 1 on any validation failure.

### Group Management (group-manage.sh)

Groups link multiple tickets for synchronized operations (e.g., deploy gates):

| Subcommand | Usage | Purpose |
|---|---|---|
| `create` | `group-manage.sh create BRE-92 BRE-180` | Create group from 2+ tickets |
| `add` | `group-manage.sh add {group_id} BRE-200` | Add ticket to existing group |
| `query` | `group-manage.sh query BRE-92` | Get group info for a ticket |
| `list` | `group-manage.sh list {group_id}` | List tickets with status |

Group IDs are deterministic SHA-256 hashes of sorted ticket IDs (first 12 chars). Group files live at `.collab/state/pipeline-groups/{GROUP_ID}.json`.

---

## Goal Gate System

### Purpose

Goal gates ensure certain phases run before the pipeline can terminate. They prevent skipping required phases (e.g., blind QA cannot be skipped).

### Configuration

Defined per-phase in `pipeline.json`:
```json
{
  "id": "blindqa",
  "goal_gate": "always"
}
```

### goal_gate Values

| Value | Meaning |
|---|---|
| `always` | Phase MUST appear in `phase_history` with a `_COMPLETE` signal before terminal |
| `if_triggered` | Only required if `phase_history` contains ANY entry for this phase |

### Evaluation (goal-gate-check.ts)

Called in the `_COMPLETE` signal processing flow, step (e):

1. **Guard**: if `NEXT_PHASE` is not a terminal phase, return `PASS` immediately
2. Extract all phases with `goal_gate` field from `pipeline.json`
3. For each gated phase, check `phase_history` in the ticket's registry
4. If any gate fails: return `REDIRECT:{phase_id}` (first failing phase)
5. If all pass: return `PASS`

### Current Goal Gates

Only one phase has a goal gate in the current configuration:
- `blindqa`: `goal_gate: "always"` -- blind QA must complete before `done`

### Redirect Behavior

When `goal-gate-check.ts` returns `REDIRECT:blindqa`, the orchestrator dispatches `blindqa` instead of advancing to `done`. This forces the skipped phase to run.

---

## The Install State Machine

### Remote Install (collab.install.ts)

Located at `src/commands/collab.install.ts`. Installs collab into any git repository from GitHub.

**Precondition**: Must be in a git repository (`.git` directory exists).

**Steps**:

1. **Clone**: `git clone --depth 1 --branch dev` from GitHub to `/tmp/collab-install-$$`
2. **Create directories**:
   - `.claude/commands/`
   - `.claude/skills/`
   - `.collab/handlers/`
   - `.collab/memory/`
   - `.collab/scripts/orchestrator/`
   - `.collab/state/pipeline-registry/`
   - `.collab/state/pipeline-groups/`
   - `.specify/scripts/`
   - `.specify/templates/`
3. **Copy files**:
   - `src/commands/*.md` --> `.claude/commands/`
   - `src/commands/collab.install.ts` --> `.claude/commands/collab.install.ts`
   - `src/skills/*` --> `.claude/skills/`
   - `minds/signals/*.ts` --> `.collab/handlers/` (+x)
   - `minds/execution/*.ts` (excluding `*.test.ts`) --> `.collab/scripts/orchestrator/`
   - `minds/execution/verify-and-complete.ts`, `minds/execution/webhook-notify.ts` --> `.collab/scripts/`
   - `.specify/scripts/*` --> `.specify/scripts/`
   - `.specify/templates/*` --> `.specify/templates/`
4. **Conditional copies** (skip if already exists, user may have customized):
   - `.claude/settings.json` -- only if not present
   - `.collab/memory/constitution.md` -- only if not present
   - `.collab/config/verify-config.json`, `verify-patterns.json`, `gates/*.md` -- only if `verify-config.json` does not exist
5. **Always-update copies** (safe to overwrite, shared infrastructure):
   - `src/config/pipeline.json` --> `.collab/config/pipeline.json`
   - `src/config/*.schema.json` --> `.collab/config/`
   - `src/config/orchestrator-contexts/*` --> `.collab/config/orchestrator-contexts/`
   - `src/config/displays/*` --> `.collab/config/displays/`
6. **Set permissions**: `chmod +x` on all `.sh` files in `.collab/scripts/orchestrator/`
7. **Verify**: check that key files exist (`collab.install.md`, `collab.install.ts`, `collab.specify.md`, skills, handlers)
8. **Cleanup**: remove temp directory

### Local Install (scripts/install.sh)

Located at `scripts/install.sh`. For the collab repo itself (development use).

**Steps**:

1. **Create directories**:
   - `.claude/commands/`
   - `.claude/skills/`
   - `.claude/hooks/handlers/`
2. **Copy commands**: `src/commands/*.md` --> `.claude/commands/`
3. **Copy skills**: `src/skills/{BlindQA,SpecCritique,SpecCreator}` --> `.claude/skills/`
4. **Copy handlers**: `minds/signals/*.ts` --> `.claude/hooks/handlers/` (+x)

Note: the local install does NOT copy orchestrator scripts, pipeline config, or coordination schemas. Those are referenced directly from `src/` via the repo structure.

### What Gets Installed Where

Complete source-to-destination mapping for remote install:

| Source | Destination | Update Policy |
|---|---|---|
| `src/commands/*.md` | `.claude/commands/` | Always overwrite |
| `src/commands/collab.install.ts` | `.claude/commands/collab.install.ts` | Always overwrite |
| `src/skills/*` | `.claude/skills/` | Always overwrite |
| `minds/signals/*.ts` | `.collab/handlers/` | Always overwrite |
| `minds/execution/*.ts` | `.collab/scripts/orchestrator/` | Always overwrite |
| `minds/execution/verify-and-complete.ts`, `webhook-notify.ts` | `.collab/scripts/` | Always overwrite |
| `src/config/pipeline.json` | `.collab/config/pipeline.json` | Always overwrite |
| `src/config/*.schema.json` | `.collab/config/` | Always overwrite |
| `src/config/orchestrator-contexts/*` | `.collab/config/orchestrator-contexts/` | Always overwrite |
| `src/config/displays/*` | `.collab/config/displays/` | Always overwrite |
| `.specify/scripts/*` | `.specify/scripts/` | Always overwrite |
| `.specify/templates/*` | `.specify/templates/` | Always overwrite |
| `src/claude-settings.json` | `.claude/settings.json` | Only if absent |
| `.specify/templates/constitution-template.md` | `.collab/memory/constitution.md` | Only if absent |
| `src/config/verify-config.json` | `.collab/config/verify-config.json` | Only if absent |
| `src/config/verify-patterns.json` | `.collab/config/verify-patterns.json` | Only if absent |
| `src/config/gates/*.md` | `.collab/config/gates/` | Only if verify-config absent |

---

## Error Handling

### _ERROR Signals

When any phase emits a `_ERROR` signal:

1. Capture the agent pane screen (scrollback 200 lines)
2. Update registry: `status=error`
3. Re-dispatch the same phase via `phase-dispatch.sh`
4. Output: "Error in '{step}' for {ticket_id}: {detail}. Retrying..."
5. Send webhook notification with status `error`

There is no explicit error count limit for `_ERROR` retries. The phase will retry indefinitely on errors.

### _FAILED Signals

`_FAILED` signals (currently only `BLINDQA_FAILED`) follow the same error handling path: capture screen, update registry, re-dispatch same phase.

### Gate Retry Exhaustion

When a gate response has `max_retries` and the `retry_count` reaches or exceeds that limit:

| on_exhaust | Behavior |
|---|---|
| `skip` | Advance to the gate's success target phase anyway |
| `abort` | Stop the pipeline (requires manual intervention) |

Currently:
- `plan_review`: `max_retries: 3`, `on_exhaust: skip` (advances to `tasks` after 3 failed revisions)
- `analyze_review`: `ESCALATION` response has no `max_retries`, `on_exhaust: abort`

### Validation Errors

| Script | Exit Code | Meaning |
|---|---|---|
| `signal-validate.ts` | 1 | No signal provided |
| `signal-validate.ts` | 2 | Bad format, nonce mismatch, or wrong phase signal |
| `signal-validate.ts` | 3 | Registry not found |
| `transition-resolve.ts` | 2 | No matching transition |
| `transition-resolve.ts` | 3 | Pipeline.json missing |
| `goal-gate-check.ts` | 2 | Gate failure (REDIRECT output) |
| `goal-gate-check.ts` | 3 | Registry or config missing |
| `registry-update.ts` | 2 | Invalid field name |
| `phase-dispatch.sh` | 2 | Phase not found in pipeline.json |
| `phase-dispatch.sh` | 3 | Registry or config missing |

---

## Command Processing

Commands are human-operator inputs to the orchestrator, prefixed with `[CMD:`.

### [CMD:add {ticket_id}]

Add a new ticket to the running orchestrator session.

1. **Validate**: ticket_id required, not already tracked, total count < 5
2. **Resolve worktree**: same logic as `orchestrator-init.sh` -- scan `specs/*/metadata.json`
3. **Spawn pane**: `Tmux.ts split` off the last agent pane, horizontal, 70%
4. **Create registry**: generate nonce, assign next color index (1-5), atomic write
5. **Rebalance layout**: `tmux set-window-option main-pane-width 30%; tmux select-layout main-vertical`
6. **Fetch Linear ticket**: MCP call with `includeRelations: true`
7. **Dispatch first phase**: read from `pipeline.json`, call `phase-dispatch.sh`
8. **Status table**: render and output "Added {ticket_id}."

### [CMD:status]

Display the current status of all tracked tickets.

Calls `status-table.sh` which renders an ASCII table with columns:
- **Ticket**: ticket ID
- **Phase**: current_step from registry
- **Status**: derived from `status` field or `last_signal` suffix
- **Gate**: group status if grouped, `--` otherwise
- **Detail**: last signal + timestamp, or hold info, or "Working on {phase} phase"

### [CMD:remove {ticket_id}]

Remove a ticket from tracking.

1. Validate ticket_id exists in registry
2. Delete `{ticket_id}.json` from registry directory
3. Render status table

Note: this does NOT kill the agent pane. The agent continues running but is no longer tracked.

### Unknown Commands

Output: "Unknown command: {action}. Supported: add, status, remove"

---

## Input Routing

The orchestrator classifies every input into exactly one category:

| Input Pattern | Route |
|---|---|
| Starts with `[SIGNAL:` | Signal Processing |
| Starts with `[CMD:` | Command Processing |
| Anything else | Ignored ("Not a pipeline signal or command, ignoring.") |

---

## Crash Recovery

### On Restart (Step 1 of Setup)

When the orchestrator starts, before initializing a new ticket:

1. Scan all `.collab/state/pipeline-registry/*.json` files
2. For each registry where `orchestrator_pane_id == $TMUX_PANE`:
   - Check if the agent pane still exists: `Tmux.ts pane-exists -w {agent_pane_id}`
   - If agent pane exists: recover state (the agent is still running)
   - If agent pane is gone: delete the registry file (stale state)
3. If any agents were recovered: render status table, output "Recovered N agent(s).", and **END RESPONSE** (do not proceed with new ticket setup)

### Graceful Exit

When the orchestrator exits gracefully:
- Delete registries where `orchestrator_pane_id == $TMUX_PANE`
- Agent panes survive -- they continue running independently

This means agent panes are resilient to orchestrator restarts. The orchestrator is a coordination layer, not a process supervisor.

---

## Tmux Automation (Tmux.ts)

The orchestrator interacts with agent panes exclusively through `Tmux.ts`, a Bun-based CLI wrapper around tmux commands.

### Commands

| Command | Usage | Purpose |
|---|---|---|
| `send` | `Tmux.ts send -w %3 -t "/collab.clarify" -d 5` | Send text + Enter to pane |
| `capture` | `Tmux.ts capture -w %3 -s 200` | Capture pane screen content |
| `split` | `Tmux.ts split -w %0 --horizontal --percentage 70 -c "cmd"` | Split pane, return new pane ID |
| `label` | `Tmux.ts label -w %3 -T "BRE-168" --color 1` | Set pane title with color |
| `pane-exists` | `Tmux.ts pane-exists -w %3` | Check if pane ID exists |
| `list` | `Tmux.ts list` | List all tmux windows |

### Key Behavior: Enter Handling

Tmux.ts ALWAYS appends `C-m` (carriage return) after text, sent as a separate `tmux send-keys` call. This is critical because:
- `Enter` sends `\n` which Claude Code treats as a newline, not a submit
- `C-m` sends `\r` which Claude Code treats as submit
- Text and `C-m` must be separate send-keys calls for reliable submission

The `--delay` flag adds a wait between the text send and the Enter press.

### Color Palette

5 color slots for pane borders (max 5 concurrent agents):

| Index | Foreground | Background |
|---|---|---|
| 1 | white | blue |
| 2 | white | green |
| 3 | black | yellow |
| 4 | white | magenta |
| 5 | black | cyan |

---

## Orchestrator Initialization Sequence (orchestrator-init.sh)

Full sequence executed during Setup Step 3:

1. **Schema validation**: validate `pipeline.json` against `pipeline.v3.schema.json` using `bunx ajv-cli`. Exit 1 on failure.
2. **Coordination check**: collect all session ticket IDs from existing registries + new ticket, run `coordination-check.sh`. Exit 1 on cycles or unknown references.
3. **Resolve repo/worktree paths**: scan `specs/*/metadata.json` for matching ticket_id, extract `worktree_path`. If not found, use current directory.
4. **Symlink setup**: if using worktree, symlink `.claude/` and `.collab/` from main repo into worktree (replace non-symlink directories if present).
5. **Spawn agent pane**: `Tmux.ts split` horizontal, 70% size, with `cd {worktree_path} && claude --dangerously-skip-permissions` as spawn command.
6. **Label pane**: `Tmux.ts label` with ticket ID and color index 1.
7. **Create registry**: generate nonce (5 hex chars from `/dev/urandom`), write JSON atomically.

Output: `AGENT_PANE={id}`, `NONCE={hex}`, `REGISTRY={path}`

---

## Verify and Complete (verify-and-complete.ts)

Agent-side script that verifies phase completion conditions before emitting the signal:

| Phase | Verification |
|---|---|
| `implement` | Check `tasks.md` for incomplete tasks (`- [ ]`). Fail if any remain. |
| `analyze` | No specific verification (orchestrator handles via gate). |
| Other | No specific checks. |

After verification passes, emits the completion signal via `emit-question-signal.ts`.

---

## Webhook Notifications (webhook-notify.ts)

Sends phase change notifications to an OpenClaw webhook endpoint which forwards to Discord.

```bash
webhook-notify.ts <ticket_id> <from_phase> <to_phase> <status>
```

Called after:
- Pipeline start: `webhook-notify.ts BRE-233 none clarify started`
- Phase advance: `webhook-notify.ts BRE-233 clarify plan running`
- Error: `webhook-notify.ts BRE-233 plan plan error`
- Completion: `webhook-notify.ts BRE-233 blindqa done complete`

---

## Configuration Files

### verify-config.json

Configures the test command for the `implement` phase verification:
```json
{
  "command": "go test ./...",
  "timeout": 120,
  "working_dir": null
}
```

### verify-patterns.json

Pattern matching rules for verification. Currently empty (`[]`).

### pipeline.v3.schema.json

JSON Schema (draft 2020-12) that defines the structure of `pipeline.json`. Key constraints:
- `command` and `actions` are mutually exclusive on a phase
- At most one `command` action per phase's actions array
- Transitions require either `to` or `gate` (oneOf)
- Gate responses are keyword-to-routing maps
- `on_exhaust` must be `skip` or `abort`

### coordination.schema.json

JSON Schema for `coordination.json` files:
- `wait_for` is either a single object or an array of objects
- Each dependency has `id` (ticket ID) and `phase` (phase ID that must complete)

---

## Shared Utilities (orchestrator-utils.ts)

Pure functions used by all TypeScript orchestrator scripts:

| Function | Purpose |
|---|---|
| `getRepoRoot()` | Get git repo root via `git rev-parse --show-toplevel` |
| `readJsonFile(path)` | Read and parse JSON, return null on error |
| `writeJsonAtomic(path, data)` | Write JSON via tmp+rename |
| `getRegistryPath(dir, ticketId)` | Build registry file path |

---

## Rules Summary

1. **One input = one response.** Never loop or poll.
2. **Ignore non-signal, non-command input.**
3. **All agent commands via programmatic tmux send.** "Already appeared" does NOT count.
4. **Never skip gate evaluation.** Gates in the transitions array are mandatory AI evaluation steps.
5. **Nonce validation handled by signal-validate.ts.** Trust its output.
6. **Process only most recent signal** if multiples arrive.
7. **Atomic writes handled by scripts.** Manual writes use tmp + mv.
8. **Track state in memory**: ticket_id, pane_id, current_step, status, detail.
9. **All routing comes from pipeline.json.** Zero hardcoded phase logic in collab.run.md.
10. **Coordination hold/release is automatic.** phase-dispatch.sh handles holds; held-release-scan.ts releases after every advance.
11. **orchestrator_context scopes judgment.** When loaded, every evaluation runs through it. Deactivate explicitly on transition.
12. **Colors 1-5**, reusable on remove.
13. **NO EXCUSES POLICY**: When a gate or orchestrator_context instructs skepticism, apply it fully.
14. **Max 5 concurrent agents.**
