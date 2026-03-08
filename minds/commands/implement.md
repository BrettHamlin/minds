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

0. **Cleanup stale context from previous runs**: Before doing anything else, scan for orphaned drone directories left by crashed or incomplete previous runs.

   ```bash
   # Find all private CLAUDE.md dirs for collab worktrees
   ls ~/.claude/projects/ | grep -E '\-collab-worktrees-|\-collab-dev'
   ```

   For each matching directory, check whether the corresponding worktree still exists:

   ```bash
   git worktree list --porcelain
   ```

   If the worktree path no longer appears in `git worktree list`, delete the orphaned directory:

   ```bash
   rm -rf ~/.claude/projects/{encoded-path}/
   ```

   Also check this Mind's own private CLAUDE.md for a stale `## Active Mind Review` section. The Mind's private CLAUDE.md path is:
   `~/.claude/projects/$(echo {collab-repo-absolute-path} | tr '/' '-' | sed 's/^-//')/CLAUDE.md`

   If that file exists and contains `## Active Mind Review`, remove that section:

   ```bash
   bun minds/lib/update-claude-section.ts "$MIND_CLAUDE" '## Active Mind Review'
   ```

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

      This creates a worktree and tmux split with a Sonnet drone in the right pane, and outputs JSON. Parse the `drone_pane` field from that JSON output:

      ```
      DRONE_PANE_ID = <json_output>.drone_pane
      ```

      Store the mapping: `{ mindName -> dronePaneId }`.

   b. **Build the Mind brief and write compaction-resilient context**: Compose a scoped instruction block for this Mind's drone, then persist it to files that survive compaction.

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

      **Write the drone's private CLAUDE.md** (survives compaction — auto-reloaded by Claude Code):

      The drone's private CLAUDE.md path is:
      `~/.claude/projects/$(echo {worktree_absolute_path} | tr '/' '-' | sed 's/^-//')/CLAUDE.md`

      Create the directory and write:

      ```bash
      DRONE_CLAUDE_DIR=~/.claude/projects/$(echo {worktree_absolute_path} | tr '/' '-' | sed 's/^-//')
      mkdir -p "$DRONE_CLAUDE_DIR"
      cat > "$DRONE_CLAUDE_DIR/CLAUDE.md" << 'EOF'
      ## Mind Identity

      You are the @{mind_name} drone for ticket {ticket_id}.
      Domain: {domain from minds.json}

      Your file boundary (only touch files in these paths):
      {owns_files list}

      ## Engineering Standards
      {full content of minds/STANDARDS.md}

      ## Mind Profile (@{mind_name})
      {full content of minds/{mind_name}/MIND.md, if it exists — omit section if file not found}

      ## Active Task
      Your current task brief is in DRONE-BRIEF.md at the worktree root.
      If you've compacted or lost context, re-read that file.
      EOF
      ```

      **Write the task brief to DRONE-BRIEF.md** in the worktree root:

      ```bash
      cat > {worktree_absolute_path}/DRONE-BRIEF.md << 'EOF'
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

      Review checklist (verify before reporting DRONE_COMPLETE):
      - [ ] All tasks marked [X]
      - [ ] No files modified outside owns_files
      - [ ] No duplicated logic (check against existing codebase)
      - [ ] All new functions have tests
      - [ ] All tests pass (`bun test`)
      - [ ] No lint errors
      - [ ] Interface contracts honored (produces/consumes match declarations)
      - [ ] No hardcoded values that should be config
      - [ ] Error messages include context (not just "failed")

      Do NOT commit your changes. The Mind will handle committing and merging after review passes.

      When all tasks are complete and the checklist passes, report: "DRONE_COMPLETE @{mind_name} {ticket_id}"
      EOF
      ```

      **Exclude DRONE-BRIEF.md from git** (per-worktree, never committed):

      ```bash
      echo "DRONE-BRIEF.md" >> {worktree_absolute_path}/.git/info/exclude
      ```

   c. **Send brief to drone pane**:

      ```bash
      bun ~/.claude/bin/tmux-send.ts {pane_id} "Read DRONE-BRIEF.md and execute the tasks described."
      ```

   d. **After dispatching all Minds in the wave**, write the Mind's own review context to its private CLAUDE.md so the Mind retains it after compaction.

      The Mind's private CLAUDE.md path is:
      `~/.claude/projects/$(echo {collab-repo-absolute-path} | tr '/' '-' | sed 's/^-//')/CLAUDE.md`

      Append (or replace existing) `## Active Mind Review` section:

      ```bash
      MIND_CLAUDE=~/.claude/projects/$(echo {collab-repo-absolute-path} | tr '/' '-' | sed 's/^-//')/CLAUDE.md

      cat > /tmp/active-mind-review.md << 'EOF'
      ## Active Mind Review
      Currently reviewing: @{mind_name_1}, @{mind_name_2}, ... for ticket {ticket_id}.
      Before reviewing each drone's work, re-read from disk:
      - minds/STANDARDS.md
      - minds/{mind_name}/MIND.md
      The Mind NEVER makes code changes directly. Review only. Send feedback to the drone if changes are needed.
      If the drone is struggling, analyze the problem and send guidance, but the drone does the implementation.
      EOF

      bun minds/lib/update-claude-section.ts "$MIND_CLAUDE" '## Active Mind Review' --content-file /tmp/active-mind-review.md
      ```

7. **Monitor wave completion**: After dispatching all Minds in a wave, poll each drone pane for the `DRONE_COMPLETE @{mind_name}` signal.

   ```bash
   # Poll loop — check every 30 seconds
   while true; do
     tmux capture-pane -t {pane_id} -p | grep "DRONE_COMPLETE @{mind_name}" && break
     sleep 30
   done
   ```

   Do not start Wave N+1 until all Minds in Wave N have emitted `DRONE_COMPLETE`.

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

   9a. **Re-read standards and profiles**: Before reviewing any drone's output:
       - Read `minds/STANDARDS.md` from disk
       - Read `minds/{mind_name}/MIND.md` from disk for each Mind being reviewed
       - Review the drone's `git diff` against both documents
       - Check for anti-patterns listed in the Mind profile
       - Verify conventions from the Mind profile were followed

       The Mind NEVER modifies code directly. If issues are found:
       - Send specific feedback to the drone via tmux-send
       - Wait for the drone to fix and re-report DRONE_COMPLETE
       - Re-review after fixes (repeating this re-read step)

   - Run `bun test` from the repo root — all tests must pass
   - Check that tasks.md has all tasks marked `[X]`
   - Confirm no files were created outside any Mind's `owns_files` boundary (cross-check with `git status`)

   9b. **Commit and merge**: After review passes for each drone (including any fix cycles), merge the drone's branch into the target branch:

       ```bash
       bun minds/lib/merge-drone.ts {worktree_path} {target_branch}
       ```

       Parse the JSON output:
       - If `hasConflicts` is `true`: report the conflict details to the user and **stop** — do not proceed to the next drone or step 10 until resolved manually.
       - If `ok` is `true`: log the `commitHash` and proceed to the next drone.

       Run this per-drone, in the same order as review (Wave 1 drones before Wave 2, etc.).

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

11. **Teardown cleanup**: After final verification passes, clean up all compaction-resilience artifacts.

    Remove the `## Active Mind Review` section from the Mind's private CLAUDE.md:

    ```bash
    MIND_CLAUDE=~/.claude/projects/$(echo {collab-repo-absolute-path} | tr '/' '-' | sed 's/^-//')/CLAUDE.md
    bun minds/lib/update-claude-section.ts "$MIND_CLAUDE" '## Active Mind Review'
    ```

    For each drone worktree that was created during this run:

    ```bash
    # Delete DRONE-BRIEF.md from the worktree
    rm -f {worktree_absolute_path}/DRONE-BRIEF.md

    # Delete the drone's private CLAUDE.md directory entirely
    rm -rf ~/.claude/projects/$(echo {worktree_absolute_path} | tr '/' '-' | sed 's/^-//')/
    ```

    Note: If the Mind crashes before reaching this step, the startup cleanup in step 0 handles orphaned directories on the next run.

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
