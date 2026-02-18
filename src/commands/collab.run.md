---
description: Orchestrate the full relay pipeline by spawning agent panes and processing signals.
---

# Split-Pane Pipeline Orchestrator

You are the **orchestrator**. You drive the Relay pipeline by spawning Claude Code agents in tmux split panes and processing signal responses. Max 5 concurrent agents.

**Scripts Directory**: `.collab/scripts/orchestrator`

> **IMPORTANT**: All script paths in this document use `.collab/scripts/orchestrator/` as the base. When running commands, use full relative paths from the repo root. For example: `.collab/scripts/orchestrator/status-table.sh` (not `.collab/scripts/orchestrator/status-table.sh`)
**Phase progression**: clarify -> plan -> tasks -> analyze -> implement -> blindqa -> done
**Pre-orchestration**: specify (runs in main pane before orchestrator spawns)
**Phase-to-command map**: clarify=`/collab.clarify`, plan=`/collab.plan`, tasks=`/collab.tasks`, analyze=`/collab.analyze`, implement=`/collab.implement`, blindqa=`/collab.blindqa`

## Arguments

`$ARGUMENTS` = ticket ID (e.g., `BRE-168`).

---

## Specify Phase (Pre-Orchestration)

### 0. Execute Specification

Before spawning the orchestrator, run specify to create the specification:

```
/collab.specify $ARGUMENTS
```

This executes the specify workflow inline with the ticket ID, creating the initial feature specification. Once specify completes, proceed to orchestrator setup.

**⚠️ CRITICAL: DO NOT STOP AFTER STEP 0**

Once `/collab.specify` completes, you MUST continue immediately to steps 1-5 in the SAME response. The specify skill returning is NOT the end of the task. The only END RESPONSE marker in the entire workflow is at step 5.

**Execution flow:** Step 0 (specify) → Steps 1-5 (setup) → END RESPONSE (step 5 only)

---

## Setup Phase

**NOTE:** You are continuing from step 0 above. Do not stop until step 5 completes.

### 1. Crash Recovery

Scan `.collab/state/pipeline-registry/*.json`. For each where `orchestrator_pane_id == $TMUX_PANE`: if agent pane exists (`bun .collab/scripts/orchestrator/Tmux.ts pane-exists -w {agent_pane_id}`), recover state. If gone, delete file. If recovered: `.collab/scripts/orchestrator/status-table.sh`, output "Recovered N agent(s)." **END RESPONSE.**

### 2. Validate

No argument -> "Usage: /collab.run <ticket-id>" and stop.

### 3. Initialize (deterministic)

```bash
.collab/scripts/orchestrator/orchestrator-init.sh $ARGUMENTS
```
Parse output: `AGENT_PANE=...`, `NONCE=...`, `REGISTRY=...`. Non-zero exit -> output error, stop.

### 4. Fetch Linear ticket

`get_issue` MCP with `includeRelations: true`. Store for later use.

### 5. Launch

```bash
bun .collab/scripts/orchestrator/Tmux.ts send -w {AGENT_PANE} -t "/collab.clarify" -d 5
```
`.collab/scripts/orchestrator/status-table.sh`. Output: **"Pipeline started for $ARGUMENTS. Waiting for signal..."** **END RESPONSE.**
`.collab/scripts/webhook-notify.sh $ARGUMENTS none clarify started`

**Note:** Specify phase already completed in step 0. Agent pane starts at clarify phase.

---

## Input Routing

1. Starts with `[SIGNAL:` -> **Signal Processing**
2. Starts with `[CMD:` -> **Command Processing**
3. Neither -> "Not a pipeline signal or command, ignoring." **END RESPONSE.**

---

## Signal Processing

### 1. Validate (deterministic)

```bash
SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/signal-validate.sh "$INPUT"
```
Exit 0 -> parse JSON: `ticket_id`, `signal_type`, `detail`, `current_step`. Non-zero -> log, **END RESPONSE.**

### 2. Get agent pane

`.collab/scripts/orchestrator/registry-read.sh {ticket_id}` -> extract `agent_pane_id`.

### 3. Route by signal suffix

#### `_QUESTION` or `_WAITING` -- Agent needs input

*AI LOGIC: Requires judgment to answer domain questions.*

1. Capture screen: `bun .collab/scripts/orchestrator/Tmux.ts capture -w {agent_pane_id} -s 200`
2. Read the AskUserQuestion prompt with options.
3. Determine best answer using: Linear ticket details, feature spec, project context, domain best practices.
4. Navigate with tmux keys: `Down`/`Up` to select, `Enter` to confirm.
5. `.collab/scripts/orchestrator/registry-update.sh {ticket_id} status=answered`
6. `.collab/scripts/orchestrator/status-table.sh`. Output: "Answered for {ticket_id}: {choice}." **END RESPONSE.**

#### `_COMPLETE` -- Step finished

1. `current_step` from signal-validate output.

2. **AI Gates** (judgment required, cannot be scripted):

   **Plan Review Gate (plan):** Read spec.md, plan.md, data-model.md, research.md. Cross-reference Linear acceptance criteria: requirements coverage, data model completeness, research decisions, phase ordering. If corrections needed: send to agent, **END RESPONSE.** If passes: continue.

   **Analyze Review Gate (analyze):**

   Track `analysis_remediation_done` in memory (boolean, default false).

   **Phase A — Analysis Remediation (runs once, when `analysis_remediation_done` is false):**
   1. Capture screen (`-s 200`). Read the full analysis report.
   2. Set `analysis_remediation_done = true`.
   3. If zero findings across all severities: skip to Phase B immediately.
   4. If any findings exist (any severity — CRITICAL, HIGH, MEDIUM, LOW):
      a. Using stored Linear ticket details (acceptance criteria, requirements, user stories, technical constraints from step 4), synthesize specific, ticket-grounded remediation instructions for every finding — not a relay of the report, but exact corrections tied to ticket requirements.
      b. Send to agent:
         "The analysis identified [N] findings. Apply ALL of the following remediations to the appropriate files (plan.md, tasks.md, spec.md):

         [One specific correction per finding, grounded in ticket context — no additional commentary]

         When all changes are applied, re-run: `.collab/scripts/verify-and-complete.sh analyze 'Analysis phase finished'`"
      c. `SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/status-table.sh`. **END RESPONSE.**

   **Phase B — Ticket Alignment Check (runs on every signal when `analysis_remediation_done` is true):**
   1. Read plan.md, tasks.md, and any artifacts present in the feature directory (data-model.md, research.md, etc.) — excluding spec.md.
   2. Cross-reference every item against stored Linear ticket details (acceptance criteria, requirements, user stories, technical constraints).
   3. If fully aligned: continue to advance.
   4. If specific gaps remain: send ONLY the exact misalignments — nothing more, nothing less:
      "The following items do not align with the ticket. Update only these:

      [File: exact item → exact correction tied to ticket requirement]

      When done, re-run: `.collab/scripts/verify-and-complete.sh analyze 'Analysis phase finished'`"
      If the agent is making no progress on the same gaps, escalate to user instead. **END RESPONSE.**

   **Deployment Gate (implement + has group_id):** `.collab/scripts/orchestrator/group-manage.sh query {ticket_id}`. Check ticket type.
   - Backend with frontends: update group gate_state=backend_deploying, deployment_status=in_progress, send deploy command with signal instruction: `bun .collab/scripts/orchestrator/Tmux.ts send -w {agent_pane_id} -t "Deploy the backend. When done, send: echo '[SIGNAL:{ticket_id}:{nonce}] IMPLEMENT_COMPLETE | deployment finished'" -d 1`. **END RESPONSE.**
   - Frontend + backend deploying: `.collab/scripts/orchestrator/registry-update.sh {ticket_id} status=held`. **END RESPONSE.**
   - Frontend + backend deployed/skipped: continue.
   - Frontend + backend failed: notify user, suggest `[CMD:retry-deploy]`/`[CMD:skip-deploy]`. **END RESPONSE.**

   **Implementation Completion Gate (implement):**

   1. Capture screen (`-s 100`). Find and read tasks.md.
   2. Count `[X]`/`[x]` vs `[ ]` per `## Phase`.
   3. Track validation_attempt_count.
   4. IF incomplete -> send "continue remaining tasks" to agent, **END RESPONSE.**

   5. **NO EXCUSES VERIFICATION** (all tasks checked):
      a. Send to agent: "Run full test suite now and show output"
      b. Wait 10 seconds, capture screen (`-s 200`)
      c. Scan output for FAILURE INDICATORS:
         - "FAILED", "ERROR", "✗", "❌", "test failed"
         - "n failing", "build failed", stack traces
         - Type errors, linting errors, compilation errors

      d. IF ANY FAILURES FOUND:
         Send to agent:
         "⛔ NO EXCUSES: Tests/builds are failing. ALL failures must be fixed before completion, including pre-existing issues you didn't create. 'I didn't touch that code' is NOT an excuse. Fix everything and re-run tests. After ALL tests pass, re-emit the completion signal: `bun .collab/handlers/emit-question-signal.ts complete 'Implementation phase finished'`"
         Increment validation_attempt_count. If the agent is making the same errors repeatedly without progress, escalate to user rather than continuing to retry.
         **END RESPONSE.**

      e. IF ALL TESTS PASS -> continue to blindqa

3. **Advance (deterministic):** `NEXT=$(.collab/scripts/orchestrator/phase-advance.sh {current_step})`

4. If `NEXT == "done"`: go to Pipeline Complete. Otherwise:
   ```bash
   .collab/scripts/orchestrator/registry-update.sh {ticket_id} current_step={NEXT} status=running
   bun .collab/scripts/orchestrator/Tmux.ts send -w {agent_pane_id} -t "{command from map}" -d 1
   ```

5. `.collab/scripts/orchestrator/status-table.sh`. Output: "'{old}' complete for {ticket_id}. Advancing to '{NEXT}'." **END RESPONSE.**
6. `.collab/scripts/webhook-notify.sh {ticket_id} {old} {NEXT} running`

#### `_ERROR` or `_FAILED` -- Error

1. Capture screen (`-s 200`). `.collab/scripts/orchestrator/registry-update.sh {ticket_id} status=error`
2. Re-send current step's command (from phase-to-command map).
3. `.collab/scripts/orchestrator/status-table.sh`. Output: "Error in '{step}' for {ticket_id}: {detail}. Retrying..." **END RESPONSE.**
4. `.collab/scripts/webhook-notify.sh {ticket_id} {step} {step} error`

---

## Command Processing

### [CMD:add {ticket_id}]

1. Validate: missing -> usage. Already tracked -> error. Count >= 5 -> error. **END RESPONSE** on any.
2. Resolve worktree (same logic as orchestrator-init.sh). Split vertically off last agent pane: `bun .collab/scripts/orchestrator/Tmux.ts split -w {last_agent_pane} -c "{spawn_cmd}"`. Generate nonce, create registry atomically, assign next color (1-5), label pane.
3. Rebalance: `tmux set-window-option main-pane-width {30%}; tmux select-layout main-vertical`
4. Fetch Linear ticket with `includeRelations: true`.
5. *AI LOGIC: Detect relationships.* Extract `relatedTo`. Check if related tickets have registries.
   - No related orchestrated -> optionally create solo group.
   - 1 existing group -> `.collab/scripts/orchestrator/group-manage.sh add {group_id} {ticket_id}`
   - 2+ groups -> `.collab/scripts/orchestrator/group-manage.sh create {all_ids}` (merge).
   - Detect type (backend/frontend/other). `.collab/scripts/orchestrator/registry-update.sh {ticket_id} group_id={gid}`
6. `bun .collab/scripts/orchestrator/Tmux.ts send -w {new_pane} -t "/collab.clarify" -d 5`
7. `.collab/scripts/orchestrator/status-table.sh`. "Added {ticket_id}." **END RESPONSE.**

### [CMD:status]

`.collab/scripts/orchestrator/status-table.sh`. **END RESPONSE.**

### [CMD:remove {ticket_id}]

Validate. `.collab/scripts/orchestrator/registry-read.sh {ticket_id}` for group_id. If grouped: remove from group, delete group if empty, notify if orphaned waits. `rm .collab/state/pipeline-registry/{ticket_id}.json`. `.collab/scripts/orchestrator/status-table.sh`. **END RESPONSE.**

### [CMD:retry-deploy {ticket_id}]

Validate: tracked, group_id, deployment_status=="failed", retry_count < 3. Read agent_pane_id/nonce. Update group: in_progress, backend_deploying, increment retry. Send deploy command with signal. `.collab/scripts/orchestrator/status-table.sh`. **END RESPONSE.**

### [CMD:skip-deploy {ticket_id}]

Validate: tracked, group_id. Update group: skipped, backend_deployed. Release waiting frontends (if at implement, advance to blindqa). `.collab/scripts/orchestrator/status-table.sh`. **END RESPONSE.**

### [CMD:group {id1} {id2} ...]

Validate: >= 2 IDs, all orchestrated. `.collab/scripts/orchestrator/group-manage.sh create {all_ids}`. Detect types, update registries. `.collab/scripts/orchestrator/status-table.sh`. **END RESPONSE.**

### Unknown

"Unknown command: {action}. Supported: add, status, remove, retry-deploy, skip-deploy, group" **END RESPONSE.**

---

## Deployment Outcome Handling

On STEP_COMPLETE with "deployment" in detail: capture screen for success/failure indicators.
- **Success**: group gate_state=backend_deployed, release frontends (read group via `.collab/scripts/orchestrator/group-manage.sh list {group_id}`, advance each frontend at implement through completion gate to blindqa).
- **Failure**: gate_state=deployment_failed, increment retry_count. If >= 3: escalate. Notify user.
- **Timeout** (15min): `tmux send-keys -t {agent_pane_id} C-c`, mark failed.

---

## Pipeline Complete

On `_COMPLETE` signal when `current_step == "blindqa"`:
1. If grouped: remove from group, delete group file if empty. Write atomically.
2. `rm .collab/state/pipeline-registry/{ticket_id}.json`
3. `.collab/scripts/orchestrator/status-table.sh`. "Pipeline complete for {ticket_id}!"
4. `.collab/scripts/webhook-notify.sh {ticket_id} {current_step} done complete`
5. Other agents running -> wait. None remain -> "All pipelines complete."

---

## Graceful Exit

Delete registries where `orchestrator_pane_id == $TMUX_PANE`. Delete orphaned group files. Agent panes survive.

---

## Rules

1. **One input = one response.** Never loop or poll.
2. **Ignore non-signal, non-command input.**
3. **All agent commands via programmatic tmux send.** "Already appeared" does NOT count.
4. **Never skip plan review gate.** Never skip analyze review gate.
5. **Nonce validation handled by signal-validate.sh.** Trust its output.
6. **Process only most recent signal** if multiples arrive.
7. **Atomic writes handled by scripts.** Manual writes use tmp + mv.
8. **Track state in memory**: ticket_id, pane_id, current_step, status, detail.
9. **Check group on every implement STEP_COMPLETE.** Deployment gates are critical.
10. **Merge groups bidirectionally.** Add order must not affect behavior.
11. **Escalate deployment failures.** Max 3 retries, then notify. Never silent-fail.
12. **Colors 1-5**, reusable on remove.
13. **NO EXCUSES POLICY**: When agent claims work complete, orchestrator MUST verify ALL tests pass and ALL builds succeed. Pre-existing failures discovered during work are NOT excuses for leaving them broken. Agent is responsible for delivering a working system, not just working new code. Reject completion if ANY failures exist, regardless of who created them.
