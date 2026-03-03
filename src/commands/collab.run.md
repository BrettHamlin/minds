---
description: Orchestrate the full relay pipeline by spawning agent panes and processing signals.
---

# Split-Pane Pipeline Orchestrator

You are the **orchestrator**. You drive the Relay pipeline by spawning Claude Code agents in tmux split panes and processing signal responses.

**Scripts Directory**: `.collab/scripts/orchestrator`
**Phase progression and commands**: driven entirely by the selected pipeline config (e.g., `.collab/config/pipeline.mobile.json`)
**Architecture**: See `architecture.md` for the three-layer design (Declarative / Execution / Judgment).

## Arguments

`$ARGUMENTS` = one or more `ticket:pipeline` pairs (e.g., `BRE-342:default BRE-341:mobile`). The `:pipeline` suffix is optional; when omitted, the ticket's Linear labels are checked for a `pipeline:*` label (e.g., `pipeline:backend`). If found, that variant is used; otherwise defaults to `"default"`.

### Parse Arguments

Extract from `$ARGUMENTS`:
- **TICKETS**: array of `{ticket_id, pipeline}` objects parsed from each space-separated token.
  - Token `BRE-342:backend` → `{ticket_id: "BRE-342", pipeline: "backend"}`
  - Token `BRE-341:mobile` → `{ticket_id: "BRE-341", pipeline: "mobile"}`
  - Token `BRE-339` (no colon) → call `get_issue` MCP for the ticket and scan its labels for one matching `pipeline:*`. If found (e.g. `pipeline:verification`), use the suffix as the pipeline name → `{ticket_id: "BRE-339", pipeline: "verification"}`. If no `pipeline:*` label exists → `{ticket_id: "BRE-339", pipeline: "default"}`.
- At least one token is required.

Use `{TICKET_ID}` and `{PIPELINE[TICKET_ID]}` (the per-ticket pipeline name) in all bun script calls. Never use a single shared pipeline name across all tickets.

---

## Pipeline Initialization

**ALL STEPS MUST EXECUTE IN YOUR FIRST RESPONSE. Your response is not complete until the Launch step outputs "Pipeline started."**

### 1. Crash Recovery (run once)

Scan `.collab/state/pipeline-registry/*.json`. For each where `orchestrator_pane_id == $TMUX_PANE`: if agent pane exists (`bun .collab/scripts/orchestrator/Tmux.ts pane-exists -w {agent_pane_id}`), recover state. If gone, delete file. If recovered: `bun .collab/scripts/orchestrator/commands/status-table.ts`, output "Recovered N agent(s)." **END RESPONSE.**

### 2. Validate (run once)

No arguments -> "Usage: /collab.run <ticket[:pipeline]> [ticket[:pipeline] ...] — e.g. BRE-342:default BRE-341:mobile or BRE-339 (pipeline inferred from Linear label)" and stop.

### 3. Per-Ticket Setup Loop

**For EACH ticket ID in TICKET_IDS**, run steps 3a–3d in order before moving to the next ticket.

#### 3a. Resolve SOURCE_REPO (AI)

*AI LOGIC: Read two JSON files to resolve the source repo path before spawning anything.*

If `.collab/config/multi-repo.json` exists:
1. Read `specs/{TICKET_ID}/metadata.json` and extract `repo_id` (if present).
2. If `repo_id` found, read `.collab/config/multi-repo.json` and look up `repos[repo_id].path`.
3. Store as `SOURCE_REPO[TICKET_ID]` for use in step 3b.

If either file is missing or `repo_id` is absent, `SOURCE_REPO[TICKET_ID]` is unset.

#### 3b. Execute Specification

Run specify to create the specification (and worktree, if needed) before the agent pane spawns:

```
If SOURCE_REPO[TICKET_ID] is set:
  Read the file `.claude/commands/collab.specify.md` and execute all its instructions with `{TICKET_ID} --pipeline {PIPELINE[TICKET_ID]} --source-repo {SOURCE_REPO[TICKET_ID]}` as input. Do NOT invoke it as a `/collab.specify` skill — read the file contents and execute the instructions inline within this response.

Otherwise:
  Read the file `.claude/commands/collab.specify.md` and execute all its instructions with `{TICKET_ID} --pipeline {PIPELINE[TICKET_ID]}` as input. Do NOT invoke it as a `/collab.specify` skill — read the file contents and execute the instructions inline within this response.
```

This reads the specify instructions and executes them inline — do NOT use the Skill tool.

#### 3b.1 Update metadata.json with worktree_path (AI)

*AI LOGIC: Capture the worktree path from specify output and persist it so orchestrator-init.ts can find it.*

After specify completes, scan the output above for a line matching:
`[specify] Created worktree at <path>`

If found:
1. Read `specs/{TICKET_ID}/metadata.json` (it already contains `ticket_id` and possibly `repo_id`).
2. Add or update the `worktree_path` field with the path extracted from the line above.
3. Write the updated JSON back to `specs/{TICKET_ID}/metadata.json`.

If no such line was found (worktree already existed or specify skipped creation), do nothing — the existing `worktree_path` value (if any) is correct.

#### 3c. Continuation checkpoint

```bash
echo "SPECIFY_COMPLETE {TICKET_ID} — continuing initialization"
```

You MUST run this command after specify completes for this ticket.

#### 3d. Initialize (deterministic)

```bash
bun .collab/scripts/orchestrator/commands/orchestrator-init.ts {TICKET_ID} --pipeline {PIPELINE[TICKET_ID]}
```
Parse output: `AGENT_PANE=...`, `NONCE=...`, `REGISTRY=...`, optionally `SOURCE_REPO=...`. Non-zero exit -> output error, stop.
Store `AGENT_PANE[TICKET_ID]`, `NONCE[TICKET_ID]`, `REGISTRY[TICKET_ID]` for use in later steps.

**Pane layout:** First ticket splits the orchestrator pane side-by-side (orchestrator left, agent right). Each subsequent ticket's agent pane is stacked below the previous — all agents remain on the right. This is handled automatically by orchestrator-init.ts.

**Multi-repo detection:** If `SOURCE_REPO` was emitted, log "Multi-repo mode active for {TICKET_ID}: {SOURCE_REPO}."

### 4. Fetch Linear tickets (loop)

For EACH ticket ID in TICKET_IDS: call `get_issue` MCP with `includeRelations: true`. Store ticket data (title, acceptance criteria, description) keyed by ticket ID for gate evaluation.

### 5. Launch (loop)

For EACH ticket ID in TICKET_IDS:
```bash
FIRST_PHASE=$(bun .collab/scripts/orchestrator/commands/phase-advance.ts --first)
bun .collab/scripts/orchestrator/commands/phase-dispatch.ts {TICKET_ID} "$FIRST_PHASE"
```

`bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: **"Pipeline started for {N} ticket(s): {TICKET_IDS joined by ', '}. Waiting for signals..."** **END RESPONSE.**
For EACH ticket ID: `.collab/scripts/webhook-notify.ts {TICKET_ID} none clarify started`

---

## Signal Queue Check (run at the start of EVERY response)

Before routing any input, check `.collab/state/signal-queue/` for pending signals that may have been missed due to context compaction:

```bash
ls .collab/state/signal-queue/*.json 2>/dev/null
```

For each file found:
1. Read the file: `cat .collab/state/signal-queue/{ticket_id}.json` — extract the `signal` field.
2. Process the signal through **Signal Processing** below exactly as if it had arrived via tmux.
3. Delete the file after processing: `rm .collab/state/signal-queue/{ticket_id}.json`

Then proceed to Input Routing for the current input.

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

Read the file `.claude/commands/collab.dependencies.md` and execute all its instructions inline with `{ticket_id_1} {ticket_id_2} ...` as input. Do NOT invoke it as a `/collab.dependencies` skill — read the file contents and execute the instructions within this response.

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
  bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} --advance-impl-phase
  ```
- Re-dispatch implement for the next phase:
  ```bash
  bun .collab/scripts/orchestrator/commands/phase-dispatch.ts {ticket_id} implement --args "phase:{next_phase}"
  ```
- `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Phase {current_impl_phase} of {total_phases} complete for {ticket_id}. Dispatching phase {next_phase}." **END RESPONSE.**

**If `implement_phase_plan` exists AND `current_impl_phase == total_phases`** (all phases done):
- Remove the plan from registry:
  ```bash
  bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} --delete-field implement_phase_plan
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

1. Read global and per-phase code review config:
   ```bash
   eval "$(bun .collab/scripts/orchestrator/commands/pipeline-config-read.ts codereview --phase {current_step})"
   ```
   This sets `CR_ENABLED`, `CR_MODEL`, `CR_MAX`, `CR_FILE`, and `PHASE_CR` from `.collab/config/pipeline.json`.
   If `CR_ENABLED == "false"`: skip to step b.

2. Check per-phase override:
   If `PHASE_CR == "false"`: skip to step b.

3. Read current attempt count from registry:
   ```bash
   CR_ATTEMPTS=$(bun .collab/scripts/orchestrator/commands/registry-read.ts {ticket_id} --field code_review_attempts --default 0)
   ```

4. Check exhaustion:
   If `CR_ATTEMPTS >= CR_MAX`:
   ```
   "Code review for {ticket_id} exhausted {CR_MAX} attempt(s). Manual review required before advancing."
   ```
   Update registry: `bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} status=blocked`
   `bun .collab/scripts/orchestrator/commands/status-table.ts`. **END RESPONSE.**

5. Increment attempt count:
   ```bash
   NEW_ATTEMPTS=$((CR_ATTEMPTS + 1))
   bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} code_review_attempts=$NEW_ATTEMPTS
   ```

6. Run code review inline (do NOT use the Skill tool):
   Read the file `.claude/commands/collab.codeReview.md` and execute all its instructions inline with `{ticket_id}$([ -n "$CR_FILE" ] && echo " --arch $CR_FILE" || echo "")` as the arguments.
   Do NOT invoke it as `/collab.codeReview` — read the file contents and execute the instructions within this response.
   Parse the output for `REVIEW: PASS` or `REVIEW: FAIL`.

7. Handle verdict:
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

##### c. Resolve transition (deterministic + conditional)

```bash
TRANSITION=$(bun .collab/scripts/orchestrator/transition-resolve.ts {current_step} {signal_type})
```

Parse `to`, `gate`, `if`, and `conditional` from output. Exit 2 means no match: log "No transition found for {current_step} → {signal_type}", **END RESPONSE.**

**If `conditional == true` and `if != null`** — Evaluate the condition (AI):

*AI LOGIC: Evaluate the `if` condition to decide whether to take the conditional branch or fall back to the plain transition.*

Supported conditions:
- **`hasGroup`**: Does the ticket have an `implement_phase_plan` with remaining phases?
  ```bash
  IMPL_PLAN=$(bun .collab/scripts/orchestrator/commands/registry-read.ts {ticket_id} --field implement_phase_plan --default '{}')
  ```
  Parse `current_impl_phase` and `total_phases` from `IMPL_PLAN`.
  - If `current_impl_phase < total_phases`: condition is **TRUE** → use the conditional `to`.
  - If `current_impl_phase >= total_phases` OR `implement_phase_plan` is absent/empty: condition is **FALSE** → re-resolve with `--plain`:
    ```bash
    TRANSITION=$(bun .collab/scripts/orchestrator/transition-resolve.ts {current_step} {signal_type} --plain)
    ```
    Re-parse `to` and `gate` from the new result.

If `gate != null`: proceed to step **d. Gate Evaluation**.
If `to != null`: skip to step **e. Goal Gate Check**.

##### d. Gate evaluation (AI logic)

*AI LOGIC: Requires full judgment to evaluate gate prompt.*

1. Load `gates[gate_name]` from pipeline.json.
2. Read the gate prompt file at `gates[gate_name].prompt`. Resolve `${TOKEN}` expressions for context variables in the prompt's YAML front matter.
3. Evaluate using: Linear ticket context (stored from Setup step 4) + current phase artifacts (spec.md, plan.md, tasks.md, analysis.md if present, etc.).
4. Your response must contain exactly one keyword from `gates[gate_name].on`. Match it.
5. Record gate decision (non-fatal — if exit 2/3, log and continue):
   ```bash
   bun .collab/scripts/orchestrator/record-gate.ts {ticket_id} {gate_name} {keyword}
   ```
6. Look up the matched response: `bun .collab/scripts/orchestrator/transition-resolve.ts --gate {gate_name} {keyword}`
7. **Feedback**: If matched response has `"feedback": true`, relay your full evaluation to the agent before routing.
8. **Route**:
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
   - Write to registry (construct the JSON string from the extracted values):
     ```bash
     bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} \
       'implement_phase_plan={"total_phases":N,"current_impl_phase":1,"phase_names":[...],"completed_impl_phases":[]}'
     ```
     Replace `N` with the actual total count and `[...]` with the actual phase names array.
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
`.collab/scripts/webhook-notify.ts {ticket_id} {current_step} {NEXT} running`

#### `_ERROR` or `_FAILED` -- Error

1. Capture screen (`-s 200`). `bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} status=error`
2. Re-dispatch current phase:
   ```bash
   bun .collab/scripts/orchestrator/commands/phase-dispatch.ts {ticket_id} {current_step}
   ```
3. `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Error in '{step}' for {ticket_id}: {detail}. Retrying..." **END RESPONSE.**
4. `.collab/scripts/webhook-notify.ts {ticket_id} {step} {step} error`

#### Any other signal -- Phase-specific outcome (transition routing)

For signals that do not match any suffix above (e.g., `VERIFY_PASS`, `VERIFY_FAIL`, `VERIFY_BLOCKED`): treat as a completed phase event and route through `transition-resolve.ts`, identical to `_COMPLETE`. Follow steps a–f under `_COMPLETE` exactly.

---

## Command Processing

### [CMD:status]

`bun .collab/scripts/orchestrator/commands/status-table.ts`. **END RESPONSE.**

### [CMD:remove {ticket_id}]

Validate. `rm .collab/state/pipeline-registry/{ticket_id}.json`. `bun .collab/scripts/orchestrator/commands/status-table.ts`. **END RESPONSE.**

### Unknown

"Unknown command: {action}. Supported: add, status, remove" **END RESPONSE.**

---

## Pipeline Complete

When `IS_TERMINAL == "true"` in the Advance step:

System nodes — all are non-fatal (exit 2 or 3 = log warning and continue):

1. Draft PR (`.before` TERMINAL node):
   `bun .collab/scripts/orchestrator/create-draft-pr.ts {ticket_id}`

2. Complete run (stamps `completed_at`, `duration_ms`, `outcome`):
   `bun .collab/scripts/orchestrator/complete-run.ts {ticket_id}`

3. Classify run (stamps `autonomous`, `intervention_count`):
   `bun .collab/scripts/orchestrator/classify-run.ts {ticket_id}`

4. Gate accuracy (evaluates gate decisions — runs after complete-run, which sets `runs.outcome`):
   `bun .collab/scripts/orchestrator/gate-accuracy-check.ts {ticket_id}`

Cleanup:
5. `rm .collab/state/pipeline-registry/{ticket_id}.json`
6. `bun .collab/scripts/orchestrator/commands/status-table.ts`. "Pipeline complete for {ticket_id}!"
7. `.collab/scripts/webhook-notify.ts {ticket_id} {current_step} done complete`
8. Other agents running -> wait. None remain -> "All pipelines complete."

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
