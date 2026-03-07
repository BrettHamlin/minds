---
description: Dispatch Mind-aware tasks to Mind+Drone pairs for collab development. Reads the @mind-tagged tasks.md, builds per-Mind briefs, and sends each to its own drone pane via tmux.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). If `$ARGUMENTS` contains a ticket ID or feature name, use it to locate the feature directory.

## Purpose

This command executes implementation for the **collab repo itself**, where work is distributed across Minds. Unlike `collab.implement.md` (which executes tasks directly in the current repo), this command is Mind-aware: it dispatches each Mind's tasks to a dedicated Mind+Drone pair running in a worktree, then monitors completion.

## Outline

1. **Load Mind registry**: Read `.collab/minds.json` from the repo root.

   ```bash
   cat .collab/minds.json
   ```

   Parse the JSON array of `MindDescription` objects. Each entry has `name`, `domain`, `owns_files`, `capabilities`, `exposes`, and `consumes`.

   If `.collab/minds.json` does not exist, run `bun minds/generate-registry.ts` first to create it, then read it.

2. **Resolve feature directory**: Run to locate tasks.md:

   ```bash
   bun .collab/scripts/resolve-feature.ts --require-tasks --include-tasks
   ```

   Parse `FEATURE_DIR` from the output. If `$ARGUMENTS` contains a ticket ID, pass it as the argument.

3. **Load and parse tasks.md**: Read `{FEATURE_DIR}/tasks.md`.

   Parse all task lines using the `parseTasks()` format from `minds/pipeline_core/task-phases.ts`. Each task line follows:

   ```
   - [ ] T001 @mind_name [P] Description with exact file path
   ```

   Group tasks by `@mind_name` tag. Tasks without an `@mind_name` tag are assigned to a default group — warn about untagged tasks but do not halt.

4. **Parse Mind-level dependencies**: Scan the `## @mind_name Tasks` section headers for dependency annotations:

   ```
   ## @execution Tasks (depends on: @pipeline_core, @signals)
   ```

   Build a dependency map: `{ mindName: string[] }` where the value is the list of Minds that must complete before this Mind can start.

5. **Build dispatch plan**: Compute execution waves from the dependency map.

   - Minds with no dependencies form **Wave 1** (run in parallel).
   - Minds whose dependencies are all in Wave N form **Wave N+1**.
   - Minds with no tasks are skipped.

   Output the plan before dispatching:

   ```
   ## Dispatch Plan

   Wave 1 (parallel): @pipeline_core, @signals, @config
   Wave 2 (parallel): @execution, @cli
   Wave 3 (sequential): @router

   Cross-Mind Contracts:
   | Producer        | Interface               | Consumer             |
   |-----------------|-------------------------|----------------------|
   | @pipeline_core  | LoadedPipeline type     | @execution, @signals |
   | @signals        | resolveSignalName()     | @execution           |
   ```

   Pause and confirm with the user before dispatching if `$ARGUMENTS` does not include `--yes` or `--auto`.

6. **For each wave, for each Mind in the wave**:

   a. **Create Mind+Drone pair** using `/dev.pane`:

      ```
      /dev.pane {ticket_id}-{mind_name}
      ```

      This creates a worktree and tmux split with a Sonnet drone in the right pane. Capture the drone pane ID immediately after:

      ```bash
      PANE_ID=$(tmux display-message -p '#{pane_id}')
      ```

      Store the mapping: `{ mindName -> paneId }`.

   b. **Build the Mind brief**: Compose a scoped instruction block for this Mind's drone.

      First, load the profile documents:

      ```bash
      # Shared standards — include in every brief
      cat minds/STANDARDS.md

      # Mind-specific profile — append if it exists
      [ -f minds/{mind_name}/MIND.md ] && cat minds/{mind_name}/MIND.md
      ```

      The brief includes:
      - **Identity**: Which Mind this drone is acting as, and its domain
      - **Owned files**: The `owns_files` list from minds.json (the drone's file-system boundary)
      - **Tasks**: The full task list for this Mind, verbatim from tasks.md
      - **Contracts**: What this Mind produces (from `exposes`) and what it consumes (from `consumes`), filtered to only what's relevant to these tasks
      - **Dependencies**: If this Mind depends on others, list the specific interfaces it should import and from where
      - **Standards**: The full content of `minds/STANDARDS.md`
      - **Mind profile**: The full content of `minds/{mind_name}/MIND.md` (if it exists)
      - **Acceptance criteria**: Derived from the task descriptions — each task's file path and behavior expectation

      Brief format:

      ```
      You are the @{mind_name} drone for ticket {ticket_id}.

      Domain: {domain from minds.json}

      Your file boundary (only touch files in these paths):
      {owns_files list}

      Tasks assigned to you:
      {task list verbatim from tasks.md}

      Interface contracts:
      - Produces: {exposes entries relevant to these tasks}
      - Consumes: {consumes entries — import from these paths, do not reimplement}

      --- Engineering Standards ---
      {full content of minds/STANDARDS.md}

      --- Mind Profile ---
      {full content of minds/{mind_name}/MIND.md, if it exists — omit section if file not found}

      Acceptance criteria:
      - All tasks marked [X] in tasks.md
      - All produced interfaces exported at their declared paths
      - `bun test` passes with no failures
      - No files modified outside your owned paths

      Review checklist (verify before reporting MIND_COMPLETE):
      - [ ] All tasks marked [X]
      - [ ] No files modified outside owns_files
      - [ ] No duplicated logic (check against existing codebase)
      - [ ] All new functions have tests
      - [ ] All tests pass (`bun test`)
      - [ ] No lint errors
      - [ ] Interface contracts honored (produces/consumes match declarations)
      - [ ] No hardcoded values that should be config
      - [ ] Error messages include context (not just "failed")

      When all tasks are complete and the checklist passes, report: "MIND_COMPLETE @{mind_name} {ticket_id}"
      ```

   c. **Send brief to drone pane**:

      ```bash
      bun ~/.claude/bin/tmux-send.ts {pane_id} "{brief}"
      ```

      For long briefs, write to a temp file first and reference it:

      ```bash
      echo "{brief}" > /tmp/mind-brief-{mind_name}.md
      bun ~/.claude/bin/tmux-send.ts {pane_id} "Read /tmp/mind-brief-{mind_name}.md and execute the tasks described."
      ```

7. **Monitor wave completion**: After dispatching all Minds in a wave, poll each drone pane for the `MIND_COMPLETE @{mind_name}` signal.

   ```bash
   # Poll loop — check every 30 seconds
   while true; do
     tmux capture-pane -t {pane_id} -p | grep "MIND_COMPLETE @{mind_name}" && break
     sleep 30
   done
   ```

   Do not start Wave N+1 until all Minds in Wave N have emitted `MIND_COMPLETE`.

   If a drone has been idle for more than 5 minutes without completing, check its pane output and intervene if it appears blocked:

   ```bash
   tmux capture-pane -t {pane_id} -p -S -50
   ```

8. **Handle failures**: If a drone emits an error or goes silent:

   - Capture the last 50 lines from its pane
   - Report the failure with context
   - Offer the option to retry (re-send the brief) or skip the Mind
   - Do not advance to the next wave if a dependency Mind failed

9. **Verify completion**: After all waves complete, verify:

   - Run `bun test` from the repo root — all tests must pass
   - Check that tasks.md has all tasks marked `[X]`
   - Confirm no files were created outside any Mind's `owns_files` boundary (cross-check with `git status`)

10. **Report**: Output final status:

    ```
    ## Dispatch Complete

    | Mind            | Tasks | Status   | Pane   |
    |-----------------|-------|----------|--------|
    | @pipeline_core  | 4     | COMPLETE | %1234  |
    | @signals        | 3     | COMPLETE | %1235  |
    | @execution      | 5     | COMPLETE | %1236  |

    Tests: PASS (N passing)
    Tasks: N/N complete
    ```

## Task Grouping Rules

When parsing tasks.md:

- Tasks with `@mind_name` → assigned to that Mind
- Tasks with no `@mind_name` → warn, attempt to assign by file path match against `owns_files`
- Tasks with `[P]` within the same Mind → can be sent as a batch in one brief; drone can parallelize them
- Tasks without `[P]` within the same Mind → must be executed sequentially; include ordering instructions in the brief

## Contract Enforcement

When building briefs for consumer Minds (those with `consumes` entries):

- Include the exact import path the producer declared in their `exposes`
- Instruct the drone: "Do NOT reimplement this — import it from the declared path. If it does not exist yet, wait and check again before proceeding."
- If the producer Mind has not completed yet, the consumer should not have been dispatched (wave ordering prevents this)

## Examples

### Single-Mind dispatch (for testing)

```
/minds.implement BRE-123 --mind pipeline_core
```

Only dispatches the `@pipeline_core` Mind, skipping all others.

### Full auto dispatch

```
/minds.implement BRE-123 --yes
```

Dispatches all waves without confirmation pause.

### Dry run (plan only, no dispatch)

```
/minds.implement BRE-123 --dry-run
```

Outputs the dispatch plan and per-Mind briefs without creating any panes or sending any messages.
