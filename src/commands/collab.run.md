---
description: Orchestrate the full relay pipeline by spawning agent panes and processing signals.
---

# Split-Pane Pipeline Orchestrator

You are the **orchestrator**. You drive the Relay pipeline by spawning Claude Code agents in tmux split panes and processing signal responses.

**Scripts Directory**: `.collab/scripts/orchestrator`
**Phase progression and commands**: driven entirely by the selected pipeline config (e.g., `.collab/config/pipeline.mobile.json`)
**Architecture**: See `architecture.md` for the three-layer design (Declarative / Execution / Judgment).

## Arguments

`$ARGUMENTS` = one or more `ticket:pipeline` pairs (e.g., `BRE-342:default BRE-341:mobile BRE-343:verification`). The `:pipeline` suffix is optional; when omitted, the ticket's Linear labels are checked for a `pipeline:*` label (e.g., `pipeline:backend`, `pipeline:verification`). If found, that variant is used; otherwise defaults to `pipeline: "default"`.

### Pre-parse: Classify arguments via `resolve-tickets.ts`

Run the CLI to classify each argument as a ticket ID or project name. The CLI does **no API calls** — it only classifies arguments deterministically.

```bash
CLASSIFIED=$(bun .collab/scripts/orchestrator/commands/resolve-tickets.ts {TOKEN_1} {TOKEN_2} ... 2>/tmp/resolve-tickets-err)
```

On non-zero exit, output the error from `/tmp/resolve-tickets-err` and stop.

The CLI outputs JSON:
```json
{
  "ticketsWithVariant": [{"ticket": "BRE-342", "variant": "backend"}],
  "ticketsNoVariant": ["BRE-339"],
  "projectNames": ["Collab Install"]
}
```

### Resolve via MCP tools

Use the Linear MCP tools (already authenticated) to resolve any items that need API access:

1. **`projectNames`** — For each project name, call `list_issues` MCP with `project: "<name>"` and `state: "started"`, then also with `state: "unstarted"`, to get all non-done tickets. For each returned issue, check its labels for `pipeline:*` to determine the variant (default to `"default"`) and `repo:*` to determine the target repo (default to unset).

2. **`ticketsNoVariant`** — For each bare ticket ID, call `get_issue` MCP to fetch the ticket and scan its labels for `pipeline:*`. If found, use that variant; otherwise default to `"default"`. Also scan for `repo:*` label to determine the target repo.

3. **`ticketsWithVariant`** — Use directly as-is. No API call needed. Still fetch the ticket via `get_issue` MCP to check for a `repo:*` label.

### Validate repo labels

For each ticket that has no `repo:*` label:

1. Read `.collab/config/multi-repo.json`. If it exists and has repos, present the options:
   - Use AskUserQuestion: "Ticket {TICKET_ID} has no `repo:*` label. Which repo should it target?"
   - Options: each key from `multi-repo.json` repos (e.g., "paper-clips-backend", "paper-clips.net") plus "current repo (no label needed)"
2. If the user selects a repo:
   - Save the `repo:{selected}` label to the ticket via `save_issue` MCP (so it persists for future runs)
   - Set `REPO[TICKET_ID]` to the selected value
3. If the user selects "current repo": leave `REPO[TICKET_ID]` unset, continue without a label.
4. If `multi-repo.json` doesn't exist: skip — single-repo setup, no label needed.

### Parse Arguments

Combine all resolved tickets into the **TICKETS** array:
- **TICKETS**: array of `{ticket_id, pipeline, repo}` objects. `repo` is the value from the `repo:*` label (e.g., `"paper-clips-backend"`), or unset if no label found.
- At least one ticket is required. If the combined result is empty, report the error and stop.

Use `{TICKET_ID}`, `{PIPELINE[TICKET_ID]}` (the per-ticket pipeline name), and `{REPO[TICKET_ID]}` (the per-ticket repo ID from the `repo:*` label) in all bun script calls. Never use a single shared pipeline name across all tickets.

---

## Pipeline Initialization

**ALL STEPS MUST EXECUTE IN YOUR FIRST RESPONSE. Your response is not complete until the Launch step outputs "Pipeline started."**

### 1. Crash Recovery (run once)

Scan `.collab/state/pipeline-registry/*.json`. For each where `orchestrator_pane_id == $TMUX_PANE`: if agent pane exists (`bun .collab/scripts/orchestrator/Tmux.ts pane-exists -w {agent_pane_id}`), recover state. If gone, delete file. If recovered: `bun .collab/scripts/orchestrator/commands/status-table.ts`, output "Recovered N agent(s)." **END RESPONSE.**

### 2. Validate (run once)

No arguments -> "Usage: /collab.run <ticket[:pipeline]> [ticket[:pipeline] ...] — e.g. BRE-342:default BRE-341:mobile or BRE-339 (pipeline inferred from Linear label)" and stop.

### 2.5. Pre-flight Command Check (run once)

Before starting orchestration, verify that the phase commands needed by the pipeline exist:

```bash
ls .claude/commands/collab.clarify.md .claude/commands/collab.plan.md .claude/commands/collab.implement.md 2>/dev/null | wc -l
```

If fewer than 3 files are found, auto-install the pipeline pack:

```bash
.collab/bin/collab pipelines install full-workflow --yes
```

If `.collab/bin/collab` does not exist (older install), log a warning and continue: "Warning: .collab/bin/collab not found — skipping pipeline pack check. Run /collab.install to upgrade."

### 3. Per-Ticket Setup Loop

**For EACH ticket ID in TICKET_IDS**, run steps 3a–3d in order before moving to the next ticket.

#### 3a. Resolve SOURCE_REPO (deterministic)

If `REPO[TICKET_ID]` is set (from the `repo:*` Linear label):

```bash
SOURCE_REPO=$(collab repo resolve {REPO[TICKET_ID]})
```

- Exit 0: store result as `SOURCE_REPO[TICKET_ID]`.
- Exit 1 (not registered): use AskUserQuestion to get the local path for this repo. Then register it:
  ```bash
  collab repo add {REPO[TICKET_ID]} {user_provided_path}
  SOURCE_REPO=$(collab repo resolve {REPO[TICKET_ID]})
  ```

If `REPO[TICKET_ID]` is unset, read `specs/{TICKET_ID}/metadata.json` and try `repo_id`:

```bash
SOURCE_REPO=$(collab repo resolve {repo_id})
```

If that also fails or no `repo_id` exists, `SOURCE_REPO[TICKET_ID]` is unset.

#### 3b. Execute Specification

Run specify to create the specification (and worktree, if needed) before the agent pane spawns:

```
If SOURCE_REPO[TICKET_ID] is set:
  Read the file `.claude/commands/collab.specify.md` and execute all its instructions with `{TICKET_ID} --pipeline {PIPELINE[TICKET_ID]} --source-repo {SOURCE_REPO[TICKET_ID]} --repo {REPO[TICKET_ID]}` as input. Do NOT invoke it as a `/collab.specify` skill — read the file contents and execute the instructions inline within this response.

Otherwise (REPO[TICKET_ID] may still be set even without SOURCE_REPO):
  Read the file `.claude/commands/collab.specify.md` and execute all its instructions with `{TICKET_ID} --pipeline {PIPELINE[TICKET_ID]}` (and `--repo {REPO[TICKET_ID]}` if REPO is set) as input. Do NOT invoke it as a `/collab.specify` skill — read the file contents and execute the instructions inline within this response.
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

#### 3b.2 Copy specs to worktree (deterministic)

*The worktree has its own working tree and may not contain the spec dir created by specify. Copy it so agents can find their spec.*

Read `specs/{TICKET_ID}/metadata.json` to get `worktree_path`. If set:

```bash
# Find the spec dir name (the directory in specs/ containing this ticket's metadata.json)
SPEC_DIR_NAME=$(basename $(dirname specs/{TICKET_ID}/metadata.json))
WORKTREE_SPEC_DIR={WORKTREE_PATH}/specs/$SPEC_DIR_NAME

# Copy if worktree doesn't already have it
if [ ! -d "$WORKTREE_SPEC_DIR" ]; then
  cp -r specs/$SPEC_DIR_NAME $WORKTREE_SPEC_DIR
fi
```

This ensures the agent in the worktree can find `specs/{branch-name}/spec.md` via `resolve-feature.ts`.

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
FIRST_PHASE=$(bun .collab/scripts/orchestrator/commands/phase-advance.ts {TICKET_ID} --first)
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
3. Delete ONLY this file after processing — do NOT batch-delete other queue files: `rm .collab/state/signal-queue/{filename}`

Then proceed to Input Routing for the current input.

---

## Signal Drain

Run this **before every END RESPONSE** to process any signals that arrived during this turn:

```bash
ls .collab/state/signal-queue/*.json 2>/dev/null
```

For each file found:
1. Read the file: `cat .collab/state/signal-queue/{filename}` — extract the `signal` field.
2. Process the signal through **Signal Processing** above exactly as if it had arrived via tmux.
3. Delete ONLY this file after processing — do NOT batch-delete other queue files: `rm .collab/state/signal-queue/{filename}`

If no files remain, end the response normally.

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

#### `_QUESTIONS` -- Batch question/answer protocol (non-interactive mode)

*AI LOGIC + DETERMINISTIC: Gather context, run inference, write resolutions.*

This signal is emitted when `@interactive(off)` is set and a phase has collected findings. The signal `detail` field contains the path to the findings file.

**Orchestrator reasoning priority (highest to lowest):**
1. Spec + ticket description (stated requirements, acceptance criteria)
2. Constitution / architecture doc (project-level principles and constraints)
3. Previous phase resolutions (decisions already made in this pipeline run)
4. Codebase patterns (how the project already does things)
5. Agent-provided context (what the agent discovered during its analysis)
6. Coordination / dependency context (coordination.json, related tickets)

**Steps:**

1. **Gather context bundle (deterministic):**
   ```bash
   bun .collab/scripts/orchestrator/commands/resolve-questions.ts {detail}
   # Writes context-bundle.json alongside the findings file
   ```

2. **Synthesize answers (model inference):**
   Read `context-bundle.json`. For each finding, reason about the answer using the priority stack above. Produce a JSON array of Resolution objects:
   ```json
   [
     {
       "findingId": "f1",
       "answer": "Use the existing Zod validation pattern from src/middleware/validate.ts",
       "reasoning": "Spec requires validation; constitution mandates type safety; existing codebase uses Zod throughout",
       "sources": ["src/middleware/validate.ts", "spec.md:AC3", ".collab/memory/constitution.md"]
     }
   ]
   ```

3. **Write resolutions (deterministic):**
   ```bash
   TICKET_ID={ticket_id} bun .collab/scripts/orchestrator/commands/write-resolutions.ts \
     {phase} {round} --stdin <<< '{resolutions_json}'
   ```
   Where `{phase}` is the phase from the findings batch and `{round}` is the round number.

4. Update registry: `bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} status=processing`
5. `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Resolutions written for {ticket_id} ({N} answers)."
6. **Re-dispatch the phase to the agent** so it can pick up the resolutions:
   ```bash
   bun .collab/scripts/orchestrator/commands/phase-dispatch.ts {ticket_id} {phase}
   ```
   This uses the same dispatch mechanism as normal phase transitions. The agent receives the phase command again, detects the existing resolutions file, applies them, and continues (or emits `_COMPLETE` if no more questions).
7. Run **Signal Drain** before ending.

#### `_QUESTION` or `_WAITING` -- Agent needs input (interactive mode)

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
6. `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Answered for {ticket_id}: {choice}." Run **Signal Drain** before ending.

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
- `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Phase {current_impl_phase} of {total_phases} complete for {ticket_id}. Dispatching phase {next_phase}." Run **Signal Drain** before ending.

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
   eval "$(bun .collab/scripts/orchestrator/commands/pipeline-config-read.ts {ticket_id} codereview --phase {current_step})"
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

Read `phases[current_step].orchestrator_context` from the pipeline config (use variant: `.collab/config/pipeline-variants/{PIPELINE[TICKET_ID]}.json` if it exists, otherwise `.collab/config/pipeline.json`):
- If value ends in `.md`: read the file. If missing, log warning and continue.
- If inline string: use directly.
- **Apply as framing for your entire signal-handling response.** All judgments flow through this context.

##### c. Resolve transition (deterministic + conditional)

```bash
TRANSITION=$(bun .collab/scripts/orchestrator/transition-resolve.ts {ticket_id} {current_step} {signal_type})
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
    TRANSITION=$(bun .collab/scripts/orchestrator/transition-resolve.ts {ticket_id} {current_step} {signal_type} --plain)
    ```
    Re-parse `to` and `gate` from the new result.

If `gate != null`: proceed to step **d. Gate Evaluation**.
If `to != null`: skip to step **e. Goal Gate Check**.

##### d. Gate evaluation (deterministic infrastructure + AI judgment)

1. **Resolve gate prompt (deterministic):**
   ```bash
   GATE_DATA=$(bun .collab/scripts/orchestrator/evaluate-gate.ts {ticket_id} {gate_name})
   ```
   Parse `prompt` and `validKeywords` from JSON output.
   - Exit 0: `prompt` contains the fully resolved gate prompt (tokens + file contents substituted). `validKeywords` lists the allowed verdict keywords.
   - Exit 3: gate not found — fall back to evaluating phase artifacts directly against the ticket acceptance criteria (ad-hoc review). Use `gate.on` keys from pipeline config as valid keywords if available.

2. **Evaluate (AI judgment):** Read the resolved `prompt`. Use Linear ticket context (stored from Setup step 4) + current phase artifacts (spec.md, plan.md, tasks.md, analysis.md if present). Your verdict must be exactly one keyword from `validKeywords`.

3. **Validate verdict and get routing (deterministic):**
   ```bash
   GATE_RESPONSE=$(bun .collab/scripts/orchestrator/evaluate-gate.ts {ticket_id} {gate_name} --verdict {keyword})
   ```
   - Exit 0: parse `response` from JSON. Contains routing instructions (`to`, `feedback`, `maxRetries`, etc.).
   - Exit 2: invalid keyword — re-read `validKeywords` from step 1 output and pick again.

4. **Record gate decision** (non-fatal — if exit 2/3, log and continue):
   ```bash
   bun .collab/scripts/orchestrator/record-gate.ts {ticket_id} {gate_name} {keyword}
   ```

5. **Feedback**: If `response.feedback` is set, relay your full evaluation to the agent before routing.

6. **Route**:
   - Response has `to`: set `NEXT={to}`, proceed to **e. Goal Gate Check**.
   - Response has no `to` (retry): increment `retry_count` in registry. Check `on_exhaust` if `retry_count >= max_retries`. Then re-dispatch:
     ```bash
     bun .collab/scripts/orchestrator/commands/phase-dispatch.ts {ticket_id} {current_step}
     ```
     Status table. Run **Signal Drain** before ending.

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
IS_TERMINAL=$(bun .collab/scripts/orchestrator/commands/phase-advance.ts {ticket_id} --is-terminal {NEXT})
```
If `IS_TERMINAL == "true"`: go to **Pipeline Complete**.

##### f.0 Dependency hold check (AI, before every non-clarify advance)

*AI LOGIC: Check if this ticket is held by a cross-ticket dependency before dispatching the next phase.*

**Only runs when `NEXT != "clarify"`** (clarify always runs in parallel, even for held tickets).

1. Read registry: `bun .collab/scripts/orchestrator/commands/registry-read.ts {ticket_id}`
2. Check for `held_by` field in the output.
3. **If `held_by` is set:**
   a. If `hold_external == true`: log "⏸ {ticket_id} is held by external blocker {held_by} — manual release required." Set `status=held`. `bun .collab/scripts/orchestrator/commands/status-table.ts`. Run **Signal Drain** before ending.
   b. Check if the blocker has completed by reading its registry:
      ```bash
      bun .collab/scripts/orchestrator/commands/registry-read.ts {held_by} 2>/dev/null || echo "REGISTRY_MISSING"
      ```
      - If output is `REGISTRY_MISSING` (or blocker registry not found): blocker pipeline has completed → proceed to step f (clear hold and advance normally):
        ```bash
        bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} --delete-field held_by
        bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} --delete-field hold_release_when
        bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} --delete-field hold_reason
        bun .collab/scripts/orchestrator/registry-update.ts {ticket_id} --delete-field hold_external
        ```
        Then continue to the normal advance below.
      - If blocker registry exists (blocker still running): set `status=held`, log "⏸ {ticket_id} is held, waiting for {held_by} to complete." `bun .collab/scripts/orchestrator/commands/status-table.ts`. Run **Signal Drain** before ending.
4. **If `held_by` is not set**: proceed normally (no hold).

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

`bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "'{current_step}' complete for {ticket_id}. Advancing to '{NEXT}'." Run **Signal Drain** before ending.

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
3. `bun .collab/scripts/orchestrator/commands/status-table.ts`. Output: "Error in '{step}' for {ticket_id}: {detail}. Retrying..." Run **Signal Drain** before ending.
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

4b. Bus teardown (if transport=bus — kills bus server + bridges, removes .collab/bus-port):
   `bun .collab/scripts/orchestrator/commands/teardown-bus.ts {ticket_id}`

Cleanup:
4c. Release dependency holds (run before registry deletion so other held tickets can detect completion):
   `bun .collab/scripts/orchestrator/held-release-scan.ts {ticket_id}`
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
