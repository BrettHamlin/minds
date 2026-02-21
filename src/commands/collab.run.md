---
description: Orchestrate the full relay pipeline by spawning agent panes and processing signals.
---

# Split-Pane Pipeline Orchestrator

You are the **orchestrator**. You drive the Relay pipeline by spawning Claude Code agents in tmux split panes and processing signal responses. Max 5 concurrent agents.

**Scripts Directory**: `.collab/scripts/orchestrator`

> **IMPORTANT**: All script paths in this document use `.collab/scripts/orchestrator/` as the base. When running commands, use full relative paths from the repo root. For example: `.collab/scripts/orchestrator/status-table.sh`
**Phase progression and commands**: driven entirely by `.collab/config/pipeline.json` (v3)
**Pre-orchestration**: specify (runs in main pane before orchestrator spawns)

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

> **Note**: `orchestrator-init.sh` now validates `pipeline.json` schema at startup and runs the coordination cycle check. If either fails, it exits before spawning panes.

### 4. Fetch Linear ticket

`get_issue` MCP with `includeRelations: true`. Store for later use (ticket title, acceptance criteria, description needed for gate evaluation).

### 5. Launch

Read the first phase from pipeline.json and dispatch its actions:

```bash
FIRST_PHASE_ID=$(jq -r '.phases[0].id' .collab/config/pipeline.json)
```

Check if this ticket has a `coordination.json` with unsatisfied `wait_for` dependencies:

```bash
COORD_FILE="specs/$ARGUMENTS/coordination.json"
```

If `coordination.json` exists: For each `wait_for` dependency, check if the dependency ticket's registry has the required phase in `phase_history` with a `_COMPLETE` signal. If any dependency is NOT yet satisfied:
```bash
SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/registry-update.sh $ARGUMENTS \
  status=held held_at="$FIRST_PHASE_ID" \
  waiting_for="{dep_id}:{dep_phase}"
```
`.collab/scripts/orchestrator/status-table.sh`. Output: **"$ARGUMENTS held at {FIRST_PHASE_ID} — waiting for {dep_id}:{dep_phase}."** **END RESPONSE.**

If no coordination hold applies, dispatch first phase actions (see **Action Dispatch** below):
- Build token context: `{"TICKET_ID": "$ARGUMENTS", "TICKET_TITLE": "{title}", "PHASE": "{FIRST_PHASE_ID}", "INCOMING_SIGNAL": "", "INCOMING_DETAIL": "", "BRANCH": "$(git rev-parse --abbrev-ref HEAD)", "WORKTREE": "{worktree_path}"}`
- Execute each action in the first phase using the **Action Dispatch** rules

`.collab/scripts/orchestrator/status-table.sh`. Output: **"Pipeline started for $ARGUMENTS. Waiting for signal..."** **END RESPONSE.**
`.collab/scripts/webhook-notify.sh $ARGUMENTS none $FIRST_PHASE_ID started`

---

## Action Dispatch

When dispatching a phase's actions to an agent, use this procedure for the phase object from pipeline.json:

1. If phase has `command` shorthand: treat as `[{"command": "{phase.command}"}]`
2. If phase has `actions` array: use the array directly
3. Build token context JSON with all seven Tier 1 built-ins
4. For each action in order:
   - **`display`**: Resolve `{{TOKEN}}` via `bun .collab/handlers/resolve-tokens.ts "{action.display}" '{context_json}'`; print resolved text to orchestrator window. Do NOT send to agent.
   - **`prompt`**: Resolve `{{TOKEN}}`; `bun .collab/scripts/orchestrator/Tmux.ts send -w {agent_pane_id} -t "{resolved}" -d 1`. Do NOT wait for signal.
   - **`command`**: Resolve `{{TOKEN}}`; `bun .collab/scripts/orchestrator/Tmux.ts send -w {agent_pane_id} -t "{resolved}" -d 1`. This is the signal-wait step — orchestrator waits for next signal.

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

*AI LOGIC: Generic config-driven interpreter. Requires judgment for gate evaluation and orchestrator_context framing.*

##### a. Append to phase_history (deterministic)

```bash
SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/registry-update.sh {ticket_id} \
  --append-phase-history "{\"phase\":\"{current_step}\",\"signal\":\"{signal_type}\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
```

##### b. Load orchestrator_context (AI logic)

Read `phases[current_step].orchestrator_context` from `.collab/config/pipeline.json`:
- If the value ends in `.md`: attempt to read the file. If missing, log "Warning: orchestrator_context file not found: {path}" and continue without context.
- If inline string: use directly as context.
- **Apply this context as framing for your entire signal-handling response.** Every judgment you make about this signal — gate evaluation, evidence assessment, routing decisions — flows through this context.

##### c. Transition lookup (AI logic)

Load `.collab/config/pipeline.json`. Find all entries in `transitions` where `from == current_step AND signal == signal_type`.

**Priority rules (FR-014):**
1. Evaluate rows with an `if` field first, in array order — first match wins.
2. If no conditional row matches: use the first plain row (no `if` field).
3. If no match at all: log "No transition found for {current_step} → {signal_type}", **END RESPONSE.**

##### d. Gate evaluation (if matched transition has `gate`)

*AI LOGIC: Requires full judgment to evaluate gate prompt.*

1. Load `gates[gate_name]` config from `.collab/config/pipeline.json`.
2. Read the gate prompt file at `gates[gate_name].prompt`. Resolve `{{TOKEN}}` expressions using **Tier 1 only** (call `bun .collab/handlers/resolve-tokens.ts` for each token in the context variables declared in the prompt's YAML front matter).
3. Evaluate the gate prompt using: Linear ticket context (stored from Setup step 4) + current phase artifacts (spec.md, plan.md, tasks.md, etc. as referenced in the YAML front matter).
4. Your gate evaluation response must contain exactly one keyword from `gates[gate_name].responses`. Match it.
5. **Feedback**: If the matched response has `"feedback": true`, relay your full gate evaluation analysis as a message to the agent before routing (e.g., "Your plan needs these specific corrections: ..."). Use `bun .collab/scripts/orchestrator/Tmux.ts send -w {agent_pane_id} -t "..." -d 1`.
6. **Route by matched response**:
   - If response has `to`: proceed to step **e. Goal Gate Check**.
   - If response has no `to` (retry current phase):
     a. Increment retry count:
        ```bash
        CURRENT_RETRY=$(jq -r '.retry_count // 0' .collab/state/pipeline-registry/{ticket_id}.json)
        NEXT_RETRY=$((CURRENT_RETRY + 1))
        SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/registry-update.sh {ticket_id} retry_count=$NEXT_RETRY
        ```
     b. Check `on_exhaust`: if `retry_count >= max_retries` in the matched response AND gate has `on_exhaust`:
        - `"skip"`: use `to` from the first response entry that has a `to` field, proceed to Goal Gate Check.
        - `"abort"`: output "Pipeline aborted: gate '{gate_name}' exhausted after {retry_count} retries in phase '{current_step}'." **END RESPONSE.**
     c. Re-dispatch current phase actions (same as advance but for current_step). Status table. **END RESPONSE.**

##### e. Goal Gate Check (before terminal advance)

*AI LOGIC: Read phase_history from registry to verify goal gate requirements.*

When the target `to` phase exists in pipeline.json:

1. Read `phase_history` from the registry:
   ```bash
   jq '.phase_history // []' .collab/state/pipeline-registry/{ticket_id}.json
   ```
2. Scan all phases in `.collab/config/pipeline.json` for `goal_gate` field.
3. For each phase with `goal_gate`:
   - **`"always"`**: phase_history MUST contain an entry where `phase == {phase_id}` AND `signal` ends in `_COMPLETE`. If missing, this phase blocks terminal advance.
   - **`"if_triggered"`**: ONLY check if phase_history contains ANY entry with `phase == {phase_id}`. If triggered, require a `_COMPLETE` entry.
4. If any check fails: redirect to the **first failing phase** (by phases-array order in pipeline.json):
   ```bash
   SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/registry-update.sh {ticket_id} current_step={FAILING_PHASE} status=running
   ```
   Re-dispatch that phase's actions (see **Action Dispatch**). Status table. Output: "Goal gate check: redirecting to '{FAILING_PHASE}' before terminal." **END RESPONSE.**
5. If all pass: proceed to step **f. Advance**.

##### f. Advance (deterministic + AI action dispatch)

`NEXT` is the resolved `to` from the matched transition (or gate response).

1. If prior phase had `orchestrator_context`, output note: "orchestrator_context deactivated for '{current_step}'."

2. Update registry:
   ```bash
   SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/registry-update.sh {ticket_id} current_step={NEXT} status=running
   ```

3. Check if NEXT phase has `"terminal": true` in pipeline.json:
   ```bash
   IS_TERMINAL=$(jq -r --arg id "{NEXT}" '.phases[] | select(.id == $id) | .terminal // false' .collab/config/pipeline.json)
   ```
   If `IS_TERMINAL == "true"`: go to **Pipeline Complete**.

4. Build token context for NEXT phase:
   ```json
   {
     "TICKET_ID": "{ticket_id}",
     "TICKET_TITLE": "{title from Linear}",
     "PHASE": "{NEXT}",
     "INCOMING_SIGNAL": "{signal_type}",
     "INCOMING_DETAIL": "{detail}",
     "BRANCH": "{current git branch}",
     "WORKTREE": "{worktree path}"
   }
   ```

5. Dispatch NEXT phase actions using **Action Dispatch** rules above.

6. **Coordination: held agent scan/release** — After advancing, scan all registries for `status == "held"`:
   ```bash
   for reg_file in .collab/state/pipeline-registry/*.json; do
     # Check if held
     # For each wait_for dep, check phase_history
     # If all satisfied: release
   done
   ```
   For each held agent, check if all `wait_for` entries from `specs/{held_ticket}/coordination.json` appear in their respective dependency ticket's `phase_history` as `*_COMPLETE`. If all satisfied:
   ```bash
   SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/registry-update.sh {held_id} status=running held_at= waiting_for=
   ```
   Dispatch that held agent's pending phase actions (using **Action Dispatch** with `held_at` phase).

7. `.collab/scripts/orchestrator/status-table.sh`. Output: "'{current_step}' complete for {ticket_id}. Advancing to '{NEXT}'." **END RESPONSE.**
8. `.collab/scripts/webhook-notify.sh {ticket_id} {current_step} {NEXT} running`

#### `_ERROR` or `_FAILED` -- Error

1. Capture screen (`-s 200`). `.collab/scripts/orchestrator/registry-update.sh {ticket_id} status=error`
2. Re-dispatch current step's actions:
   ```bash
   jq -r --arg id "$current_step" \
     '.phases[] | select(.id == $id) | if .command then .command else (.actions[] | select(.command) | .command) end' \
     .collab/config/pipeline.json
   ```
   Use **Action Dispatch** to re-send.
3. `.collab/scripts/orchestrator/status-table.sh`. Output: "Error in '{step}' for {ticket_id}: {detail}. Retrying..." **END RESPONSE.**
4. `.collab/scripts/webhook-notify.sh {ticket_id} {step} {step} error`

---

## Command Processing

### [CMD:add {ticket_id}]

1. Validate: missing -> usage. Already tracked -> error. Count >= 5 -> error. **END RESPONSE** on any.
2. Resolve worktree (same logic as orchestrator-init.sh). Split vertically off last agent pane: `bun .collab/scripts/orchestrator/Tmux.ts split -w {last_agent_pane} -c "{spawn_cmd}"`. Generate nonce, create registry atomically, assign next color (1-5), label pane.
3. Rebalance: `tmux set-window-option main-pane-width {30%}; tmux select-layout main-vertical`
4. Fetch Linear ticket with `includeRelations: true`.
5. Check if ticket has `coordination.json` with unsatisfied `wait_for` dependencies (same logic as Launch step 5). If hold applies: mark held, skip first command. Otherwise dispatch first phase actions.
6. `.collab/scripts/orchestrator/status-table.sh`. "Added {ticket_id}." **END RESPONSE.**

### [CMD:status]

`.collab/scripts/orchestrator/status-table.sh`. **END RESPONSE.**

### [CMD:remove {ticket_id}]

Validate. `rm .collab/state/pipeline-registry/{ticket_id}.json`. `.collab/scripts/orchestrator/status-table.sh`. **END RESPONSE.**

### Unknown

"Unknown command: {action}. Supported: add, status, remove" **END RESPONSE.**

---

## Pipeline Complete

When the Advance step determines the next phase has `"terminal": true`:

1. `rm .collab/state/pipeline-registry/{ticket_id}.json`
2. `.collab/scripts/orchestrator/status-table.sh`. "Pipeline complete for {ticket_id}!"
3. Other agents running -> wait. None remain -> "All pipelines complete."

---

## Graceful Exit

Delete registries where `orchestrator_pane_id == $TMUX_PANE`. Agent panes survive.

---

## Rules

1. **One input = one response.** Never loop or poll.
2. **Ignore non-signal, non-command input.**
3. **All agent commands via programmatic tmux send.** "Already appeared" does NOT count.
4. **Never skip gate evaluation.** Gates in the `transitions` array are mandatory AI evaluation steps.
5. **Nonce validation handled by signal-validate.sh.** Trust its output.
6. **Process only most recent signal** if multiples arrive.
7. **Atomic writes handled by scripts.** Manual writes use tmp + mv.
8. **Track state in memory**: ticket_id, pane_id, current_step, status, detail.
9. **All routing comes from pipeline.json.** Zero hardcoded phase-specific conditions in this file.
10. **Coordination hold/release is automatic.** Check after every advance.
11. **orchestrator_context scopes judgment.** When loaded, every evaluation runs through it. Deactivate explicitly on transition.
12. **Colors 1-5**, reusable on remove.
13. **NO EXCUSES POLICY**: When a gate or orchestrator_context instructs skepticism, apply it fully. Challenge claims, demand evidence, reject insufficient proof.
