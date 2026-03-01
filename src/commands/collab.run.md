---
description: Orchestrate the full relay pipeline by spawning agent panes and processing signals.
---

# Split-Pane Pipeline Orchestrator

You are the **orchestrator**. You drive the Relay pipeline by spawning Claude Code agents in tmux split panes and processing signal responses. Max 5 concurrent agents.

**Scripts Directory**: `.collab/scripts/orchestrator`
**Phase progression and commands**: driven entirely by the selected pipeline config (e.g., `.collab/config/pipeline.mobile.json`)
**Architecture**: See `architecture.md` for the three-layer design (Declarative / Execution / Judgment).

## Arguments

`$ARGUMENTS` = ticket ID and pipeline name (e.g., `BRE-168 --pipeline mobile`). The `--pipeline` flag is required.

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
Parse output: `AGENT_PANE=...`, `NONCE=...`, `REGISTRY=...`, `CONFIG_FILE=...`. Store `CONFIG_FILE` for all subsequent pipeline config references. Non-zero exit -> output error, stop.

### 4. Fetch Linear ticket

`get_issue` MCP with `includeRelations: true`. Store for later use (ticket title, acceptance criteria, description needed for gate evaluation).

### 5. Launch

```bash
FIRST_PHASE=$(jq -r '.phases[0].id' "$CONFIG_FILE")
.collab/scripts/orchestrator/phase-dispatch.sh $ARGUMENTS "$FIRST_PHASE"
```

`.collab/scripts/orchestrator/status-table.sh`. Output: **"Pipeline started for $ARGUMENTS. Waiting for signal..."** **END RESPONSE.**
`.collab/scripts/webhook-notify.sh $ARGUMENTS none clarify started`

---

## Input Routing

1. Starts with `[SIGNAL:` -> **Signal Processing**
2. Starts with `[CMD:` -> **Command Processing**
3. Neither -> "Not a pipeline signal or command, ignoring." **END RESPONSE.**

---

## Signal Processing

### 1. Validate (deterministic)

```bash
SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/signal-validate.ts "$INPUT"
```
Exit 0 -> parse JSON: `ticket_id`, `signal_type`, `detail`, `current_step`. Non-zero -> log, **END RESPONSE.**

### 2. Get agent pane

`.collab/scripts/orchestrator/registry-read.sh {ticket_id}` -> extract `agent_pane_id`.

### 3. Route by signal suffix

#### `_QUESTION` or `_WAITING` -- Agent needs input

*AI LOGIC: Requires judgment to answer domain questions.*

The signal `detail` field contains the question and all options encoded with `§` separator:
`"Question text§Option A (Recommended)§Option B§Option C"`

1. Split `detail` on `§`: index 0 = question, index 1..N = option labels.
2. Determine best answer using: Linear ticket details, feature spec, project context, domain best practices. Default to the `(Recommended)` option (index 1, position 0) unless ticket context clearly warrants a different choice.
3. Count `Down` presses needed: chosen option's index minus 1 (position 0 = 0 presses, position 1 = 1 press, etc.).
4. Wait 2 seconds for AskUserQuestion UI to render, then navigate:
   ```bash
   sleep 2
   tmux send-keys -t {agent_pane_id} Down   # repeat N times for chosen position
   tmux send-keys -t {agent_pane_id} Enter  # confirm selection
   ```
5. `.collab/scripts/orchestrator/registry-update.ts {ticket_id} status=answered`
6. `.collab/scripts/orchestrator/status-table.sh`. Output: "Answered for {ticket_id}: {choice}." **END RESPONSE.**

#### `_COMPLETE` -- Step finished

##### a. Append phase history (deterministic)

```bash
SCRIPTS=.collab/scripts/orchestrator && $SCRIPTS/registry-update.ts {ticket_id} \
  --append-phase-history "{\"phase\":\"{current_step}\",\"signal\":\"{signal_type}\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
```

##### b. Load orchestrator context (AI)

Read `phases[current_step].orchestrator_context` from `.collab/config/pipeline.json`:
- If value ends in `.md`: read the file. If missing, log warning and continue.
- If inline string: use directly.
- **Apply as framing for your entire signal-handling response.** All judgments flow through this context.

##### c. Resolve transition (deterministic)

```bash
TRANSITION=$(.collab/scripts/orchestrator/transition-resolve.ts {current_step} {signal_type})
```

Parse `to` and `gate` from output. Exit 2 means no match: log "No transition found for {current_step} → {signal_type}", **END RESPONSE.**

If `gate != null`: proceed to step **d. Gate Evaluation**.
If `to != null`: skip to step **e. Goal Gate Check**.

##### d. Gate evaluation (AI logic)

*AI LOGIC: Requires full judgment to evaluate gate prompt.*

1. Load `gates[gate_name]` from pipeline.json.
2. Read the gate prompt file at `gates[gate_name].prompt`. Resolve `{{TOKEN}}` expressions for context variables in the prompt's YAML front matter.
3. Evaluate using: Linear ticket context (stored from Setup step 4) + current phase artifacts (spec.md, plan.md, tasks.md, analysis.md if present, etc.).
4. Your response must contain exactly one keyword from `gates[gate_name].responses`. Match it.
5. Look up the matched response: `jq -r --arg gate "{gate_name}" --arg resp "{keyword}" '.gates[$gate].responses[$resp]' .collab/config/pipeline.json`
6. **Feedback**: If matched response has `"feedback": true`, relay your full evaluation to the agent before routing.
7. **Route**:
   - Response has `to`: set `NEXT={to}`, proceed to **e. Goal Gate Check**.
   - Response has no `to` (retry): increment `retry_count` in registry. Check `on_exhaust` if `retry_count >= max_retries`. Then re-dispatch:
     ```bash
     .collab/scripts/orchestrator/phase-dispatch.sh {ticket_id} {current_step}
     ```
     Status table. **END RESPONSE.**

##### e. Goal gate check (deterministic)

Only runs before terminal. If `NEXT` is not the terminal phase, script returns PASS immediately.

```bash
GOAL=$(.collab/scripts/orchestrator/goal-gate-check.ts {ticket_id} {NEXT})
```

If output starts with `REDIRECT:`: extract phase id, dispatch it, status table, output "Goal gate check: redirecting to '{phase}' before terminal." **END RESPONSE.**

##### f. Advance (deterministic)

`NEXT` is the resolved phase from step c or d.

Check if `NEXT` is terminal:
```bash
IS_TERMINAL=$(jq -r --arg id "{NEXT}" '.phases[] | select(.id == $id) | .terminal // false' "$CONFIG_FILE")
```
If `IS_TERMINAL == "true"`: go to **Pipeline Complete**.

Update registry and dispatch next phase:
```bash
SCRIPTS=.collab/scripts/orchestrator
$SCRIPTS/registry-update.ts {ticket_id} current_step={NEXT} status=running
$SCRIPTS/phase-dispatch.sh {ticket_id} {NEXT}
$SCRIPTS/held-release-scan.ts {ticket_id}
```

`.collab/scripts/orchestrator/status-table.sh`. Output: "'{current_step}' complete for {ticket_id}. Advancing to '{NEXT}'." **END RESPONSE.**
`.collab/scripts/webhook-notify.sh {ticket_id} {current_step} {NEXT} running`

#### `_ERROR` or `_FAILED` -- Error

1. Capture screen (`-s 200`). `.collab/scripts/orchestrator/registry-update.ts {ticket_id} status=error`
2. Re-dispatch current phase:
   ```bash
   .collab/scripts/orchestrator/phase-dispatch.sh {ticket_id} {current_step}
   ```
3. `.collab/scripts/orchestrator/status-table.sh`. Output: "Error in '{step}' for {ticket_id}: {detail}. Retrying..." **END RESPONSE.**
4. `.collab/scripts/webhook-notify.sh {ticket_id} {step} {step} error`

#### Any other signal -- Phase-specific outcome (transition routing)

For signals that do not match any suffix above (e.g., `VERIFY_PASS`, `VERIFY_FAIL`, `VERIFY_BLOCKED`): treat as a completed phase event and route through `transition-resolve.ts`, identical to `_COMPLETE`. Follow steps a–f under `_COMPLETE` exactly.

---

## Command Processing

### [CMD:add {ticket_id}]

1. Validate: missing -> usage. Already tracked -> error. Count >= 5 -> error. **END RESPONSE** on any.
2. Resolve worktree (same logic as orchestrator-init.sh). Split vertically off last agent pane: `bun .collab/scripts/orchestrator/Tmux.ts split -w {last_agent_pane} -c "{spawn_cmd}"`. Generate nonce, create registry atomically, assign next color (1-5), label pane.
3. Rebalance: `tmux set-window-option main-pane-width {30%}; tmux select-layout main-vertical`
4. Fetch Linear ticket with `includeRelations: true`.
5. Dispatch first phase:
   ```bash
   FIRST_PHASE=$(jq -r '.phases[0].id' "$CONFIG_FILE")
   .collab/scripts/orchestrator/phase-dispatch.sh {ticket_id} "$FIRST_PHASE"
   ```
   (Script handles coordination hold automatically — check output for `HELD:` prefix and update status table accordingly.)
6. `.collab/scripts/orchestrator/status-table.sh`. "Added {ticket_id}." **END RESPONSE.**

### [CMD:status]

`.collab/scripts/orchestrator/status-table.sh`. **END RESPONSE.**

### [CMD:remove {ticket_id}]

Validate. `rm .collab/state/pipeline-registry/{ticket_id}.json`. `.collab/scripts/orchestrator/status-table.sh`. **END RESPONSE.**

### Unknown

"Unknown command: {action}. Supported: add, status, remove" **END RESPONSE.**

---

## Pipeline Complete

When `IS_TERMINAL == "true"` in the Advance step:

1. `rm .collab/state/pipeline-registry/{ticket_id}.json`
2. `.collab/scripts/orchestrator/status-table.sh`. "Pipeline complete for {ticket_id}!"
3. `.collab/scripts/webhook-notify.sh {ticket_id} {current_step} done complete`
4. Other agents running -> wait. None remain -> "All pipelines complete."

---

## Graceful Exit

Delete registries where `orchestrator_pane_id == $TMUX_PANE`. Agent panes survive.

---

## Rules

1. **One input = one response.** Never loop or poll.
2. **Ignore non-signal, non-command input.**
3. **All agent commands via programmatic tmux send.** "Already appeared" does NOT count.
4. **Never skip gate evaluation.** Gates in the `transitions` array are mandatory AI evaluation steps.
5. **Nonce validation handled by signal-validate.ts.** Trust its output.
6. **Process only most recent signal** if multiples arrive.
7. **Atomic writes handled by scripts.** Manual writes use tmp + mv.
8. **Track state in memory**: ticket_id, pane_id, current_step, status, detail.
9. **All routing comes from pipeline.json.** Zero hardcoded phase logic in this file.
10. **Coordination hold/release is automatic.** phase-dispatch.sh handles holds; held-release-scan.ts releases after every advance.
11. **orchestrator_context scopes judgment.** When loaded, every evaluation runs through it. Deactivate explicitly on transition.
12. **Colors 1-5**, reusable on remove.
13. **NO EXCUSES POLICY**: When a gate or orchestrator_context instructs skepticism, apply it fully. Challenge claims, demand evidence, reject insufficient proof.
