---
description: Dispatch Mind-aware tasks to Mind+Drone pairs for collab development. Reads the @mind-tagged tasks.md, builds per-Mind briefs, and dispatches each to a dedicated drone.
---

> **IMPORTANT:** Execute these steps directly and sequentially. Do NOT wrap this workflow in PAI Algorithm phases, ISC criteria, capability selection, or any other meta-framework. Follow the numbered steps exactly as written.

> **IMPORTANT:** Do not ask for confirmation at any step. Do not use AskUserQuestion. Proceed with dispatch immediately.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). If `$ARGUMENTS` contains a ticket ID or feature name, use it to locate the feature directory.

## Purpose

This command executes implementation for the **collab repo itself**, where work is distributed across Minds. Unlike `collab.implement.md` (which executes tasks directly in the current repo), this command is Mind-aware: it dispatches each Mind's tasks to a dedicated Mind+Drone pair running in a worktree, then waits for completion signals.

## Outline

0. **Cleanup stale context from previous runs**: Before doing anything else, clean up orphaned bus processes and drone directories left by crashed or incomplete previous runs.

   ```bash
   bun minds/transport/minds-teardown.ts --cleanup-orphans
   ```

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

5b. **Lint contracts**: Run the deterministic contract linter before dispatching any drones:

    ```bash
    bun minds/lib/contracts.ts lint {FEATURE_DIR}/tasks.md .collab/minds.json
    ```

    Parse the JSON output. If there are errors:
    - Display each error with its task ID and message
    - Do NOT proceed to dispatch — fix the tasks.md first
    - Common fixes: add missing `produces:` annotations, fix file paths to match `owns_files`, remove references to other Minds from task descriptions

    If there are only warnings, display them but proceed with dispatch.

5c. **Start bus lifecycle**: Start the Minds message bus before dispatching any drones.

    Run the start command (fire-and-forget — it writes state to disk):

    ```bash
    bun minds/transport/minds-bus-lifecycle.ts start --ticket {ticket_id} --pane $TMUX_PANE
    ```

    Then read the bus URL from the state file (the start command persists state automatically):

    ```bash
    cat .collab/state/minds-bus-{ticket_id}.json
    ```

    Parse `busUrl` from the JSON. Store `BUS_URL` for use throughout steps 6–11.

6. **For each wave, for each Mind in the wave**:

   a. **Create Mind+Drone pair** using `drone-pane.ts`:

      ```bash
      bun minds/lib/drone-pane.ts --mind {mind_name} --ticket {ticket_id} --bus-url $BUS_URL
      ```

      Parse the JSON output:

      ```
      DRONE_PANE_ID = <json_output>.drone_pane
      WORKTREE     = <json_output>.worktree
      MIND_PANE_ID = $TMUX_PANE
      ```

      Store the mapping: `{ mindName -> { dronePaneId, worktree } }`.

      `drone-pane.ts` handles all setup. The Mind does not need to do any of that.

   b. **Write task-specific brief to DRONE-BRIEF.md**:

      Use Bash (`cat` heredoc) to write to `{worktree}/DRONE-BRIEF.md`. Do NOT use the Write tool — it requires a Read first and will error.

      This is the ONLY thing the Mind needs to customize — `drone.launch` already set up identity, domain, owns_files, STANDARDS.md, and MIND.md in the drone's private CLAUDE.md.

      ```bash
      cat > {worktree}/DRONE-BRIEF.md << 'EOF'
      # Drone Brief: @{mind_name} for {ticket_id}

      Mind pane ID (for sending completion signal): {mind_pane_id}

      ## Tasks assigned to you

      {task list verbatim from tasks.md for this Mind}

      ## Interface contracts

      - Produces: {exposes entries relevant to these tasks}
      - Consumes: {consumes entries — import from these paths, do not reimplement}

      ## Acceptance criteria

      - All tasks marked [X] in tasks.md
      - All produced interfaces exported at their declared paths
      - `bun test` passes with no failures
      - No files modified outside your owned paths

      ## Review checklist (verify before reporting DRONE_COMPLETE)

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

      When all tasks are complete and the checklist passes, send completion signal via the bus:

      ```bash
      bun minds/transport/minds-publish.ts --channel minds-{ticket_id} --type DRONE_COMPLETE --payload '{"mindName":"{mind_name}"}'
      ```

      The bus URL is resolved automatically from `BUS_URL` env var or `.collab/bus-port`.
      EOF
      ```

   c. **Send brief to drone pane**:

      ```bash
      bun minds/lib/tmux-send.ts {drone_pane} "Read DRONE-BRIEF.md and execute the tasks described."
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

7. **Wait for drone completion signals**: After dispatching all Minds in a wave, **end your response**. Do not run any more commands. Do not sleep. Do not poll. Do not capture drone panes. Just stop.

   The drone will send `DRONE_COMPLETE` to this pane when done. When you see it, continue to the next step.

   Track which Minds have reported completion. Do not start Wave N+1 until all Minds in Wave N have reported.

7b. **Between-waves cleanup**: After all drones in a wave complete, BEFORE launching the next wave, for each drone in the wave:

   ```bash
   tmux kill-pane -t {drone_pane}
   bun minds/lib/cleanup.ts all {worktree_path}
   ```

8. **Handle failures**: If a drone reports an error instead of DRONE_COMPLETE:

   - Report the failure
   - Re-send the brief to retry, or skip the Mind
   - Do not advance to the next wave if a dependency Mind failed

9. **Verify completion**: After all waves complete, verify:

   9a. **Re-read standards and profiles and produce a citation-based review**: Before reviewing any drone's output:
       - Read `minds/STANDARDS.md` from disk
       - Read `minds/{mind_name}/MIND.md` from disk for each Mind being reviewed
       - Run `git diff` in the drone's worktree to get the exact diff

       **For EVERY item in MIND.md's "Review Focus" section AND EVERY item in STANDARDS.md's review checklist**, produce an explicit citation entry in this format:

       ```
       MIND.md "Review Focus" — <item text>
         → diff: <file>:<line> <quoted snippet> — PASS
         OR
         → NO corresponding code in diff — VIOLATION
       ```

       Example citation:
       ```
       MIND.md says: Every DB open has a matching close
         → drone's classify-run.test.ts line 135: db.close() after assertion — PASS

       STANDARDS.md checklist: No duplicated logic
         → drone's emit-signal.ts line 47: calls resolveSignalName() (imported, not re-implemented) — PASS

       MIND.md says: All registry writes go through registryPath()
         → NO corresponding code in diff — VIOLATION: emit-handler.ts line 22 constructs path inline
       ```

       **Every review focus item must have a citation. "Looks fine" or checkbox ticks without evidence are not acceptable.** If an item has no corresponding code in the diff, that is automatically a VIOLATION — call it out explicitly.

       After the citation block, provide a verdict: PASS (proceed to merge) or FAIL (list violations, send feedback to drone).

       The Mind NEVER modifies code directly. If issues are found:
       - Send the specific violation citations to the drone via bus publish
         ```bash
         bun minds/transport/minds-publish.ts --channel minds-{ticket_id} --type DRONE_REVIEW_FAIL --payload '{"mindName":"{mind_name}","feedback":"{violation details}"}'
         ```
       - Wait for the drone to fix and re-report DRONE_COMPLETE on the bus
       - Re-review after fixes (repeating this full citation-based review step)

   - Run `bun test` from the repo root — all tests must pass
   - Check that tasks.md has all tasks marked `[X]`
   - Confirm no files were created outside any Mind's `owns_files` boundary (cross-check with `git status`)

   9b. **Commit and merge**: After review passes for each drone (including any fix cycles), merge the drone's branch into the target branch:

       ```bash
       bun minds/lib/merge-drone.ts {worktree_path} {target_branch} --log-content "..."
       ```

       The `--log-content` value should be a one-sentence summary of what was learned from the review in step 9a — patterns confirmed, violations caught, or decisions made (e.g., "All registry writes used registryPath(); no inline path construction found.").

       Parse the JSON output:
       - If `hasConflicts` is `true`: report the conflict details to the user and **stop** — do not proceed to the next drone or step 10 until resolved manually.
       - If `ok` is `true`: log the `commitHash` and proceed to the next drone.

       Run this per-drone, in the same order as review (Wave 1 drones before Wave 2, etc.).

   9c. **Flush review learnings to memory**: After merging each drone, write a brief summary of what was learned during the review to the reviewing Mind's daily log. This captures institutional knowledge — patterns confirmed, violations caught, architectural decisions observed.

       For each Mind that completed review, write a temporary file with the review summary, then call write-cli.ts:

       ```bash
       cat > /tmp/{mind_name}-review-learnings.md << 'EOF'
       ## Review of @{mind_name} for {ticket_id}

       {1-3 sentences summarizing key findings from the citation-based review:
        - Patterns confirmed (e.g., "All path construction uses paths.ts utilities")
        - Violations found and fixed (e.g., "Drone initially had inline path construction, fixed on re-dispatch")
        - Decisions made (e.g., "Added --content-file flag for multi-line review summaries")}
       EOF

       bun minds/memory/lib/write-cli.ts --mind {mind_name} --content-file /tmp/{mind_name}-review-learnings.md
       ```

       **Rules:**
       - Write concrete, durable insights — not session-specific state
       - Skip the flush for trivial passes with nothing new learned
       - One write per Mind per review cycle
       - Clean up the temp file after the write succeeds

   9d. **Integration / E2E tests**: After ALL drones are merged, run real-world tests the way a user would use the feature. No fixtures, no mocks — actual execution.

       ```bash
       # Run all unit tests first (sanity check post-merge)
       bun test
       ```

       Then run real-world verification appropriate to the feature:
       - **Pipeline/collab flows**: Launch a new tmux window, start Claude Code, run the flow end-to-end (e.g., `/collab.run`)
       - **Web features**: Use the Playwright/Browser skill to test in a real browser
       - **iOS features**: Use the iOS simulator skill to verify on-device
       - **CLI commands**: Actually run the command and verify the output
       - **API changes**: Make real HTTP requests against a running server

       If integration tests fail:
       - Identify which Mind's domain the failure is in
       - Spin up a new drone for that Mind to fix the issue
       - Re-merge and re-test
       - Do NOT ship without passing real-world tests

       Real-world test coverage is mandatory. Unit tests alone are not sufficient to ship.

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

11. **Memory hygiene**: After all drones are merged and tests pass, run hygiene on participating Minds to prune stale entries from their MEMORY.md files.

    For each Mind that was dispatched in this run:

    ```bash
    bun minds/memory/lib/hygiene-cli.ts --mind {mind_name} --prune
    ```

    This is a lightweight, idempotent operation — safe to run even if no stale entries exist. It removes any lines marked `<!-- STALE -->` from the Mind's MEMORY.md.

    Note: Promotion (daily log → MEMORY.md) is deliberately left manual. Automatic promotion requires judgment about which entries are durable — run `hygiene-cli.ts --mind {name} --promote "insight text"` manually when you identify entries worth promoting.

12. **Teardown cleanup**: After final verification passes, clean up all compaction-resilience artifacts.

    Tear down the Minds bus (reads PIDs from state file, kills them, clears state):

    ```bash
    bun minds/transport/minds-teardown.ts --ticket {ticket_id}
    ```

    Remove the `## Active Mind Review` section from the Mind's private CLAUDE.md:

    ```bash
    MIND_CLAUDE=~/.claude/projects/$(echo {collab-repo-absolute-path} | tr '/' '-' | sed 's/^-//')/CLAUDE.md
    bun minds/lib/update-claude-section.ts "$MIND_CLAUDE" '## Active Mind Review'
    ```

    For each drone worktree that was created during this run:

    ```bash
    # Full cleanup: DRONE-BRIEF.md + private CLAUDE.md dir + worktree removal (--force for untracked files)
    bun minds/lib/cleanup.ts all {worktree_absolute_path}
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
