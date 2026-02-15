---
description: Orchestrate the full relay pipeline by spawning agent panes and processing signals.
---

# Split-Pane Pipeline Orchestrator

You are the **orchestrator**. You drive the Relay pipeline by spawning Claude Code agents in tmux split panes and processing signal responses. Max 5 concurrent agents.

**Scripts**: `SCRIPTS=~/.claude/skills/TmuxAutomation/Tools`
**Phase progression**: clarify -> plan -> tasks -> analyze -> implement -> blindqa -> done
**Phase-to-command map**: plan=`/relay.plan`, tasks=`/relay.tasks`, analyze=`/relay.analyze`, implement=`/relay.implement`, blindqa=`/relay.blindqa`

## Arguments

`$ARGUMENTS` = ticket ID (e.g., `BRE-168`).

---

## Setup Phase

### 1. Crash Recovery

Scan `~/.claude/MEMORY/STATE/pipeline-registry/*.json`. For each where `orchestrator_pane_id == $TMUX_PANE`: if agent pane exists (`bun $SCRIPTS/Tmux.ts pane-exists -w {agent_pane_id}`), recover state. If gone, delete file. If recovered: `$SCRIPTS/status-table.sh`, output "Recovered N agent(s)." **END RESPONSE.**

### 2. Validate

No argument -> "Usage: /relay.pipeline <ticket-id>" and stop.

### 3. Initialize (deterministic)

```bash
$SCRIPTS/orchestrator-init.sh $ARGUMENTS
```
Parse output: `AGENT_PANE=...`, `NONCE=...`, `REGISTRY=...`. Non-zero exit -> output error, stop.

### 4. Fetch Linear ticket

`get_issue` MCP with `includeRelations: true`. Store for later use.

### 5. Launch

```bash
bun $SCRIPTS/Tmux.ts send -w {AGENT_PANE} -t "/relay.clarify" -d 5
```
`$SCRIPTS/status-table.sh`. Output: **"Pipeline started for $ARGUMENTS. Waiting for signal..."** **END RESPONSE.**

---

## Input Routing

1. Starts with `[SIGNAL:` -> **Signal Processing**
2. Starts with `[CMD:` -> **Command Processing**
3. Neither -> "Not a pipeline signal or command, ignoring." **END RESPONSE.**

---

## Signal Processing

### 1. Validate (deterministic)

```bash
echo "$INPUT" | $SCRIPTS/signal-validate.sh
```
Exit 0 -> parse JSON: `ticket_id`, `signal_type`, `detail`, `current_step`. Non-zero -> log, **END RESPONSE.**

### 2. Get agent pane

`$SCRIPTS/registry-read.sh {ticket_id}` -> extract `agent_pane_id`.

### 3. Route by signal suffix

#### `_QUESTION` or `_WAITING` -- Agent needs input

*AI LOGIC: Requires judgment to answer domain questions.*

1. Capture screen: `bun $SCRIPTS/Tmux.ts capture -w {agent_pane_id} -s 200`
2. Read the AskUserQuestion prompt with options.
3. Determine best answer using: Linear ticket details, feature spec, project context, domain best practices.
4. Navigate with tmux keys: `Down`/`Up` to select, `Enter` to confirm.
5. `$SCRIPTS/registry-update.sh {ticket_id} status=answered`
6. `$SCRIPTS/status-table.sh`. Output: "Answered for {ticket_id}: {choice}." **END RESPONSE.**

#### `_COMPLETE` -- Step finished

1. `current_step` from signal-validate output.

2. **AI Gates** (judgment required, cannot be scripted):

   **Plan Review Gate (plan):** Read spec.md, plan.md, data-model.md, research.md. Cross-reference Linear acceptance criteria: requirements coverage, data model completeness, research decisions, phase ordering. If corrections needed: send to agent, **END RESPONSE.** If passes: continue.

   **Analyze Review Gate (analyze):** Capture screen, review findings for blockers. Must explicitly approve or identify re-analysis concerns. If concerns: send message, **END RESPONSE.** If approved: continue.

   **Deployment Gate (implement + has group_id):** `$SCRIPTS/group-manage.sh query {ticket_id}`. Check ticket type.
   - Backend with frontends: update group gate_state=backend_deploying, deployment_status=in_progress, send deploy command with signal instruction: `bun $SCRIPTS/Tmux.ts send -w {agent_pane_id} -t "Deploy the backend. When done, send: echo '[SIGNAL:{ticket_id}:{nonce}] IMPLEMENT_COMPLETE | deployment finished'" -d 1`. **END RESPONSE.**
   - Frontend + backend deploying: `$SCRIPTS/registry-update.sh {ticket_id} status=held`. **END RESPONSE.**
   - Frontend + backend deployed/skipped: continue.
   - Frontend + backend failed: notify user, suggest `[CMD:retry-deploy]`/`[CMD:skip-deploy]`. **END RESPONSE.**

   **Implementation Completion Gate (implement):** Capture screen (`-s 100`). Find and read tasks.md. Count `[X]`/`[x]` vs `[ ]` per `## Phase`. Track validation_attempt_count (max 3). Incomplete -> send "continue remaining tasks" to agent, **END RESPONSE.** All 100% -> continue.

3. **Advance (deterministic):** `NEXT=$($SCRIPTS/phase-advance.sh {current_step})`

4. If `NEXT == "done"`: go to Pipeline Complete. Otherwise:
   ```bash
   $SCRIPTS/registry-update.sh {ticket_id} current_step={NEXT} status=running
   bun $SCRIPTS/Tmux.ts send -w {agent_pane_id} -t "{command from map}" -d 1
   ```

5. `$SCRIPTS/status-table.sh`. Output: "'{old}' complete for {ticket_id}. Advancing to '{NEXT}'." **END RESPONSE.**

#### `_ERROR` or `_FAILED` -- Error

1. Capture screen (`-s 200`). `$SCRIPTS/registry-update.sh {ticket_id} status=error`
2. Re-send current step's command (from phase-to-command map).
3. `$SCRIPTS/status-table.sh`. Output: "Error in '{step}' for {ticket_id}: {detail}. Retrying..." **END RESPONSE.**

---

## Command Processing

### [CMD:add {ticket_id}]

1. Validate: missing -> usage. Already tracked -> error. Count >= 5 -> error. **END RESPONSE** on any.
2. Resolve worktree (same logic as orchestrator-init.sh). Split vertically off last agent pane: `bun $SCRIPTS/Tmux.ts split -w {last_agent_pane} -c "{spawn_cmd}"`. Generate nonce, create registry atomically, assign next color (1-5), label pane.
3. Rebalance: `tmux set-window-option main-pane-width {30%}; tmux select-layout main-vertical`
4. Fetch Linear ticket with `includeRelations: true`.
5. *AI LOGIC: Detect relationships.* Extract `relatedTo`. Check if related tickets have registries.
   - No related orchestrated -> optionally create solo group.
   - 1 existing group -> `$SCRIPTS/group-manage.sh add {group_id} {ticket_id}`
   - 2+ groups -> `$SCRIPTS/group-manage.sh create {all_ids}` (merge).
   - Detect type (backend/frontend/other). `$SCRIPTS/registry-update.sh {ticket_id} group_id={gid}`
6. `bun $SCRIPTS/Tmux.ts send -w {new_pane} -t "/relay.clarify" -d 5`
7. `$SCRIPTS/status-table.sh`. "Added {ticket_id}." **END RESPONSE.**

### [CMD:status]

`$SCRIPTS/status-table.sh`. **END RESPONSE.**

### [CMD:remove {ticket_id}]

Validate. `$SCRIPTS/registry-read.sh {ticket_id}` for group_id. If grouped: remove from group, delete group if empty, notify if orphaned waits. `rm ~/.claude/MEMORY/STATE/pipeline-registry/{ticket_id}.json`. `$SCRIPTS/status-table.sh`. **END RESPONSE.**

### [CMD:retry-deploy {ticket_id}]

Validate: tracked, group_id, deployment_status=="failed", retry_count < 3. Read agent_pane_id/nonce. Update group: in_progress, backend_deploying, increment retry. Send deploy command with signal. `$SCRIPTS/status-table.sh`. **END RESPONSE.**

### [CMD:skip-deploy {ticket_id}]

Validate: tracked, group_id. Update group: skipped, backend_deployed. Release waiting frontends (if at implement, advance to blindqa). `$SCRIPTS/status-table.sh`. **END RESPONSE.**

### [CMD:group {id1} {id2} ...]

Validate: >= 2 IDs, all orchestrated. `$SCRIPTS/group-manage.sh create {all_ids}`. Detect types, update registries. `$SCRIPTS/status-table.sh`. **END RESPONSE.**

### Unknown

"Unknown command: {action}. Supported: add, status, remove, retry-deploy, skip-deploy, group" **END RESPONSE.**

---

## Deployment Outcome Handling

On STEP_COMPLETE with "deployment" in detail: capture screen for success/failure indicators.
- **Success**: group gate_state=backend_deployed, release frontends (read group via `$SCRIPTS/group-manage.sh list {group_id}`, advance each frontend at implement through completion gate to blindqa).
- **Failure**: gate_state=deployment_failed, increment retry_count. If >= 3: escalate. Notify user.
- **Timeout** (15min): `tmux send-keys -t {agent_pane_id} C-c`, mark failed.

---

## Pipeline Complete

On `_COMPLETE` signal when `current_step == "blindqa"`:
1. If grouped: remove from group, delete group file if empty. Write atomically.
2. `rm ~/.claude/MEMORY/STATE/pipeline-registry/{ticket_id}.json`
3. `$SCRIPTS/status-table.sh`. "Pipeline complete for {ticket_id}!"
4. Other agents running -> wait. None remain -> "All pipelines complete."

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
