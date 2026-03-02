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

## Pipeline Initialization (Steps 0–5)

**ALL SIX STEPS MUST EXECUTE IN YOUR FIRST RESPONSE. Your response is not complete until step 5 outputs "Pipeline started."**

### 0. Execute Specification

Before spawning the orchestrator, run specify to create the specification:

```
Read the file `.claude/commands/collab.specify.md` and execute all its instructions with `$ARGUMENTS` as input. Do NOT invoke it as a `/collab.specify` skill — read the file contents and execute the instructions inline within this response.
```

This reads the specify instructions and executes them inline — do NOT use the Skill tool.

### 0.5 Continuation checkpoint

```bash
echo "SPECIFY_COMPLETE — continuing initialization"
```

You MUST run this command after specify completes. DO NOT output any text to the user until step 5.

### 1. Crash Recovery

Scan `.collab/state/pipeline-registry/*.json`. For each where `orchestrator_pane_id == $TMUX_PANE`: if agent pane exists (`bun .collab/scripts/orchestrator/Tmux.ts pane-exists -w {agent_pane_id}`), recover state. If gone, delete file. If recovered: `bun .collab/scripts/orchestrator/commands/status-table.ts`, output "Recovered N agent(s)." **END RESPONSE.**

### 2. Validate

No argument -> "Usage: /collab.run <ticket-id>" and stop.

### 3. Initialize (deterministic)

```bash
bun .collab/scripts/orchestrator/commands/orchestrator-init.ts $ARGUMENTS
```
Parse output: `AGENT_PANE=...`, `NONCE=...`, `REGISTRY=...`. Non-zero exit -> output error, stop.

**Multi-repo detection (AI, after init):** If `.collab/config/multi-repo.json` exists, log "Multi-repo mode active." The registry will contain `repo_id` and `repo_path` fields for this ticket. Signal validation and phase dispatch will automatically route to the per-repo pipeline.json.

### 4. Fetch Linear ticket

`get_issue` MCP with `includeRelations: true`. Store for later use (ticket title, acceptance criteria, description needed for gate evaluation).

### 5. Launch

```bash
FIRST_PHASE=$(bun .collab/scripts/orchestrator/commands/phase-advance.ts --first)
bun .collab/scripts/orchestrator/commands/phase-dispatch.ts $ARGUMENTS "$FIRST_PHASE"
```

`bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: **"Pipeline started for $ARGUMENTS. Waiting for signal..."** **END RESPONSE.**
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
SCRIPTS=.collab/scripts/orchestrator && bun $SCRIPTS/signal-validate.ts "$INPUT"
```
Exit 0 -> parse JSON: `ticket_id`, `signal_type`, `detail`, `current_step`. Non-zero -> log, **END RESPONSE.**

### 2. Get agent pane

`bun .collab/scripts/orchestrator/commands/registry-read.ts {ticket_id}` -> extract `agent_pane_id`.

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
5. `bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} status=answered`
6. `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Answered for {ticket_id}: {choice}." **END RESPONSE.**

#### `_COMPLETE` -- Step finished

##### a.0 Multi-repo dependency check (AI, analyze phase only)

*AI LOGIC: After all tracked tickets complete their `analyze` phase in multi-repo mode.*

Only runs when **all** of the following are true:
1. `.collab/config/multi-repo.json` exists (multi-repo mode active)
2. `current_step == analyze`
3. Every ticket in `.collab/state/pipeline-registry/*.json` has `analyze` in its `phase_history` with a `_COMPLETE` signal

If all conditions met: dispatch the dependency analyzer before any ticket advances to `implement`:

```bash
/collab.dependencies {ticket_id_1} {ticket_id_2} ...
```

Where the ticket IDs are all currently tracked tickets. Wait for `DEPENDENCY_COMPLETE` signal, then proceed normally with transition resolution for the triggering ticket.

##### a. Append phase history (deterministic)

```bash
SCRIPTS=.collab/scripts/orchestrator && bun $SCRIPTS/registry-update.ts {ticket_id} \
  --append-phase-history "{\"phase\":\"{current_step}\",\"signal\":\"{signal_type}\",\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
```

##### a.1 Phased implement continuation (AI, IMPLEMENT_COMPLETE only)

*AI LOGIC: Intercept IMPLEMENT_COMPLETE before normal routing when a phase plan is active.*

If `current_step == implement`:

1. Read registry: `bun .collab/scripts/orchestrator/commands/registry-read.ts {ticket_id}`
2. Parse `implement_phase_plan` from output.

**If `implement_phase_plan` exists AND `current_impl_phase < total_phases`** (more phases remain):
- Compute `next_phase = current_impl_phase + 1`
- Update registry to advance the plan:
  ```bash
  REGFILE=".collab/state/pipeline-registry/{ticket_id}.json"
  jq '.implement_phase_plan.completed_impl_phases += [.implement_phase_plan.current_impl_phase] | .implement_phase_plan.current_impl_phase += 1' \
    "$REGFILE" > /tmp/_impl_upd.json && mv /tmp/_impl_upd.json "$REGFILE"
  ```
- Re-dispatch implement for the next phase:
  ```bash
  bun .collab/scripts/orchestrator/commands/phase-dispatch.ts {ticket_id} implement --args "phase:{next_phase}"
  ```
- `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Phase {current_impl_phase} of {total_phases} complete for {ticket_id}. Dispatching phase {next_phase}." **END RESPONSE.**

**If `implement_phase_plan` exists AND `current_impl_phase == total_phases`** (all phases done):
- Remove the plan from registry:
  ```bash
  REGFILE=".collab/state/pipeline-registry/{ticket_id}.json"
  jq 'del(.implement_phase_plan)' "$REGFILE" > /tmp/_impl_done.json && mv /tmp/_impl_done.json "$REGFILE"
  ```
- Proceed to step b (normal `_COMPLETE` flow).

**If no `implement_phase_plan`**: proceed to step b normally.

##### a.2 Code review intercept (AI, IMPLEMENT_COMPLETE only)

*AI LOGIC: When codeReview is enabled, evaluate code quality before advancing.*

Only runs when **all** of the following are true:
1. `current_step` contains `implement` (implement phase name)
2. The signal type ends in `_COMPLETE`
3. `phases[current_step].codeReview.enabled` is not `false` in pipeline.json (per-phase override)
4. Top-level `codeReview.enabled` is not explicitly `false` in pipeline.json (absent = enabled with defaults)

**If global `codeReview` is absent from pipeline.json, treat as enabled with defaults (model: claude-opus-4-6, maxAttempts: 3). Only skip if `codeReview.enabled` is explicitly `false`.**

Procedure:

1. Read global `codeReview` from `.collab/config/pipeline.json`:
   ```bash
   PIPELINE=$(cat .collab/config/pipeline.json)
   CR_ENABLED=$(echo "$PIPELINE" | jq -r '.codeReview.enabled // true')
   ```
   If `CR_ENABLED == "false"`: skip to step b.

2. Check per-phase override:
   ```bash
   PHASE_CR=$(echo "$PIPELINE" | jq -r --arg p "{current_step}" '.phases[$p].codeReview.enabled // "inherit"')
   ```
   If `PHASE_CR == "false"`: skip to step b.

3. Read review config with defaults:
   ```bash
   CR_MODEL=$(echo "$PIPELINE" | jq -r '.codeReview.model // "claude-opus-4-6"')
   CR_MAX=$(echo "$PIPELINE" | jq -r '.codeReview.maxAttempts // 3')
   CR_FILE=$(echo "$PIPELINE" | jq -r '.codeReview.file // empty')
   ```

4. Read current attempt count from registry:
   ```bash
   CR_ATTEMPTS=$(bun .collab/scripts/orchestrator/commands/registry-read.ts {ticket_id} | jq -r '.code_review_attempts // 0')
   ```

5. Check exhaustion:
   If `CR_ATTEMPTS >= CR_MAX`:
   ```
   "Code review for {ticket_id} exhausted {CR_MAX} attempt(s). Manual review required before advancing."
   ```
   Update registry: `bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} status=blocked`
   `bun .collab/scripts/orchestrator/commands/status-table.ts`. **END RESPONSE.**

6. Increment attempt count:
   ```bash
   NEW_ATTEMPTS=$((CR_ATTEMPTS + 1))
   bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} code_review_attempts=$NEW_ATTEMPTS
   ```

7. Spawn inline code review subagent:
   ```
   /collab.codeReview {ticket_id}$([ -n "$CR_FILE" ] && echo " --arch $CR_FILE" || echo "")
   ```
   Wait for the subagent to complete. Parse its output for `REVIEW: PASS` or `REVIEW: FAIL`.

8. Handle verdict:
   - **PASS**: Reset attempt count:
     ```bash
     bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} code_review_attempts=0
     ```
     Log: "Code review passed for {ticket_id} (attempt {NEW_ATTEMPTS}/{CR_MAX}). Advancing." Proceed to step b.
   - **FAIL**: Extract findings (everything after `REVIEW: FAIL` line). Relay to implementing agent:
     ```bash
     bun .collab/scripts/orchestrator/Tmux.ts send -w {agent_pane_id} -t "⛔ CODE REVIEW FAILED (attempt {NEW_ATTEMPTS}/{CR_MAX})

{findings}

Fix all blocking findings above and re-run the verification script to re-emit IMPLEMENT_COMPLETE." -d 1
     sleep 1
     tmux send-keys -t {agent_pane_id} C-m
     ```
     `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Code review failed for {ticket_id} (attempt {NEW_ATTEMPTS}/{CR_MAX}). Findings sent to agent." **END RESPONSE.**

##### b. Load orchestrator context (AI)

Read `phases[current_step].orchestrator_context` from `.collab/config/pipeline.json`:
- If value ends in `.md`: read the file. If missing, log warning and continue.
- If inline string: use directly.
- **Apply as framing for your entire signal-handling response.** All judgments flow through this context.

##### c. Resolve transition (deterministic)

```bash
TRANSITION=$(bun .collab/scripts/orchestrator/transition-resolve.ts {current_step} {signal_type})
```

Parse `to` and `gate` from output. Exit 2 means no match: log "No transition found for {current_step} → {signal_type}", **END RESPONSE.**

If `gate != null`: proceed to step **d. Gate Evaluation**.
If `to != null`: skip to step **e. Goal Gate Check**.

##### d. Gate evaluation (AI logic)

*AI LOGIC: Requires full judgment to evaluate gate prompt.*

1. Load `gates[gate_name]` from pipeline.json.
2. Read the gate prompt file at `gates[gate_name].prompt`. Resolve `${TOKEN}` expressions for context variables in the prompt's YAML front matter.
3. Evaluate using: Linear ticket context (stored from Setup step 4) + current phase artifacts (spec.md, plan.md, tasks.md, analysis.md if present, etc.).
4. Your response must contain exactly one keyword from `gates[gate_name].on`. Match it.
5. Look up the matched response: `bun .collab/scripts/orchestrator/transition-resolve.ts --gate {gate_name} {keyword}`
6. **Feedback**: If matched response has `"feedback": true`, relay your full evaluation to the agent before routing.
7. **Route**:
   - Response has `to`: set `NEXT={to}`, proceed to **e. Goal Gate Check**.
   - Response has no `to` (retry): increment `retry_count` in registry. Check `on_exhaust` if `retry_count >= max_retries`. Then re-dispatch:
     ```bash
     bun .collab/scripts/orchestrator/commands/phase-dispatch.ts {ticket_id} {current_step}
     ```
     Status table. **END RESPONSE.**

##### e. Goal gate check (deterministic)

Only runs before terminal. If `NEXT` is not the terminal phase, script returns PASS immediately.

```bash
GOAL=$(bun .collab/scripts/orchestrator/goal-gate-check.ts {ticket_id} {NEXT})
```

If output starts with `REDIRECT:`: extract phase id, dispatch it, status table, output "Goal gate check: redirecting to '{phase}' before terminal." **END RESPONSE.**

##### f. Advance (deterministic)

`NEXT` is the resolved phase from step c or d.

Check if `NEXT` is terminal:
```bash
IS_TERMINAL=$(bun .collab/scripts/orchestrator/commands/phase-advance.ts --is-terminal {NEXT})
```
If `IS_TERMINAL == "true"`: go to **Pipeline Complete**.

Update registry and dispatch next phase:
```bash
SCRIPTS=.collab/scripts/orchestrator
bun $SCRIPTS/registry-update.ts {ticket_id} current_step={NEXT} status=running
```

**If `NEXT == implement`** — Phased Implementation Check (AI):

*AI LOGIC: Count phases and build a phase plan for large task sets.*

1. Locate tasks.md in the worktree: check `{worktree_path}/specs/*/tasks.md`, then `{worktree_path}/tasks.md`.
2. Count phase headers: `grep -c '^## Phase [0-9]' /path/to/tasks.md` (treat as 0 if file not found).
3. **If phase count >= 3**:
   - Extract phase names: `grep '^## Phase ' /path/to/tasks.md`
   - Build `implement_phase_plan`:
     ```json
     {
       "total_phases": N,
       "current_impl_phase": 1,
       "phase_names": ["Phase 1: ...", "Phase 2: ...", ...],
       "completed_impl_phases": []
     }
     ```
   - Write to registry using jq (jq is a required dependency):
     ```bash
     REGFILE=".collab/state/pipeline-registry/{ticket_id}.json"
     PLAN_JSON='{"total_phases":N,"current_impl_phase":1,"phase_names":[...],"completed_impl_phases":[]}'
     jq --argjson p "$PLAN_JSON" '. + {implement_phase_plan: $p}' "$REGFILE" \
       > /tmp/_impl_plan.json && mv /tmp/_impl_plan.json "$REGFILE"
     ```
   - Dispatch with phase arg and run held-release scan:
     ```bash
     bun $SCRIPTS/commands/phase-dispatch.ts {ticket_id} implement --args "phase:1"
     bun $SCRIPTS/held-release-scan.ts {ticket_id}
     ```
   - Status table. Output: "Phased implementation started for {ticket_id}: dispatching phase 1 of {N}." **END RESPONSE.**
4. **If phase count < 3** (or tasks.md not found): dispatch normally (no phase plan):
   ```bash
   bun $SCRIPTS/commands/phase-dispatch.ts {ticket_id} {NEXT}
   bun $SCRIPTS/held-release-scan.ts {ticket_id}
   ```

**If `NEXT != implement`**: dispatch normally:
```bash
bun $SCRIPTS/commands/phase-dispatch.ts {ticket_id} {NEXT}
bun $SCRIPTS/held-release-scan.ts {ticket_id}
```

`bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "'{current_step}' complete for {ticket_id}. Advancing to '{NEXT}'." **END RESPONSE.**

##### f.1 Before hooks (AI)

*AI LOGIC: Check for before hooks on the next phase before dispatching it.*

Read `phases[NEXT].before` from `.collab/config/pipeline.json`:
- If `before` array is non-empty: for each `{phase}` entry, dispatch it as a hook phase first:
  ```bash
  bun $SCRIPTS/commands/phase-dispatch.ts {ticket_id} {hook_phase}
  ```
  Wait for the hook phase's `_COMPLETE` signal before dispatching `NEXT`. Log: "Before-hook '{hook_phase}' dispatched for {ticket_id} before '{NEXT}'." **END RESPONSE** and wait for signal.
- If `before` is absent or empty: dispatch `NEXT` directly (normal flow above).

##### f.2 After hooks (AI)

*AI LOGIC: When a `_COMPLETE` signal arrives and the completed phase has after hooks, run them before advancing.*

In step **a** (_COMPLETE handler), after appending phase history, read `phases[current_step].after` from `.collab/config/pipeline.json`:
- If `after` array is non-empty: for each `{phase}` entry, dispatch it as a hook before routing to the next phase:
  ```bash
  bun $SCRIPTS/commands/phase-dispatch.ts {ticket_id} {hook_phase}
  ```
  Wait for hook `_COMPLETE`, then proceed to step b. Log: "After-hook '{hook_phase}' dispatched for {ticket_id} after '{current_step}'."
- If `after` is absent or empty: proceed normally.
`.collab/scripts/webhook-notify.sh {ticket_id} {current_step} {NEXT} running`

#### `_ERROR` or `_FAILED` -- Error

1. Capture screen (`-s 200`). `bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} status=error`
2. Re-dispatch current phase:
   ```bash
   bun .collab/scripts/orchestrator/commands/phase-dispatch.ts {ticket_id} {current_step}
   ```
3. `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Error in '{step}' for {ticket_id}: {detail}. Retrying..." **END RESPONSE.**
4. `.collab/scripts/webhook-notify.sh {ticket_id} {step} {step} error`

#### Any other signal -- Phase-specific outcome (transition routing)

For signals that do not match any suffix above (e.g., `VERIFY_PASS`, `VERIFY_FAIL`, `VERIFY_BLOCKED`): treat as a completed phase event and route through `transition-resolve.ts`, identical to `_COMPLETE`. Follow steps a–f under `_COMPLETE` exactly.

---

## Command Processing

### [CMD:add {ticket_id} [--repo {repo_id}]]

1. Validate: missing -> usage. Already tracked -> error. Count >= 5 -> error. **END RESPONSE** on any.
2. If `--repo {repo_id}` is provided: look up `repos[repo_id].path` from `.collab/config/multi-repo.json`. Use that path as the spawn target instead of the worktree. Store `repo_id` and `repo_path` in the new registry entry.
3. Resolve worktree (same logic as `commands/orchestrator-init.ts`). Split vertically off last agent pane: `bun .collab/scripts/orchestrator/Tmux.ts split -w {last_agent_pane} -c "{spawn_cmd}"`. Generate nonce, create registry atomically, assign next color (1-5), label pane.
3. Rebalance: `tmux set-window-option main-pane-width {30%}; tmux select-layout main-vertical`
4. Fetch Linear ticket with `includeRelations: true`.
5. Dispatch first phase:
   ```bash
   FIRST_PHASE=$(bun .collab/scripts/orchestrator/commands/phase-advance.ts --first)
   bun .collab/scripts/orchestrator/commands/phase-dispatch.ts {ticket_id} "$FIRST_PHASE"
   ```
   (Script handles coordination hold automatically — check output for `HELD:` prefix and update status table accordingly.)
6. `bun .collab/scripts/orchestrator/commands/status-table.ts`. "Added {ticket_id}." **END RESPONSE.**

### [CMD:status]

`bun .collab/scripts/orchestrator/commands/status-table.ts`. **END RESPONSE.**

### [CMD:remove {ticket_id}]

Validate. `rm .collab/state/pipeline-registry/{ticket_id}.json`. `bun .collab/scripts/orchestrator/commands/status-table.ts`. **END RESPONSE.**

### Unknown

"Unknown command: {action}. Supported: add, status, remove" **END RESPONSE.**

---

## Pipeline Complete

When `IS_TERMINAL == "true"` in the Advance step:

1. `rm .collab/state/pipeline-registry/{ticket_id}.json`
2. `bun .collab/scripts/orchestrator/commands/status-table.ts`. "Pipeline complete for {ticket_id}!"
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
10. **Coordination hold/release is automatic.** commands/phase-dispatch.ts handles holds; held-release-scan.ts releases after every advance.
11. **orchestrator_context scopes judgment.** When loaded, every evaluation runs through it. Deactivate explicitly on transition.
12. **Colors 1-5**, reusable on remove.
13. **NO EXCUSES POLICY**: When a gate or orchestrator_context instructs skepticism, apply it fully. Challenge claims, demand evidence, reject insufficient proof.
