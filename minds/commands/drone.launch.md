---
description: Create a worktree and launch a Claude Code Sonnet drone for Minds work. Writes the drone's private CLAUDE.md and DRONE-BRIEF.md before launching. Replaces /dev.pane for Minds development.
---

> **IMPORTANT:** Execute these steps directly and sequentially. Do NOT wrap this workflow in PAI Algorithm phases, ISC criteria, capability selection, or any other meta-framework. Follow the numbered steps exactly as written.

## Arguments

`$ARGUMENTS` — Required: `{mind_name} {ticket_id}`. Example: `pipeline_core BRE-123`

## Steps

1. **Parse arguments**: Extract `mind_name` and `ticket_id` from `$ARGUMENTS`.

   ```bash
   MIND_NAME="<first token of $ARGUMENTS>"
   TICKET_ID="<second token of $ARGUMENTS>"
   ```

   If either is missing, stop and ask for both.

2. **Launch the drone pane**: `drone-pane.ts` assembles the CLAUDE.md and DRONE-BRIEF.md automatically.

   ```bash
   bun minds/lib/drone-pane.ts \
     --mind ${MIND_NAME} \
     --ticket ${TICKET_ID} \
     --pane $TMUX_PANE \
     --mind-pane $TMUX_PANE
   ```

   Parse the JSON output:
   - `drone_pane` — tmux pane ID of the new drone
   - `worktree` — absolute path to the worktree
   - `branch` — branch name (`minds/{TICKET_ID}-{MIND_NAME}`)
   - `base` — base branch
   - `claude_dir` — path to the drone's private ~/.claude/projects/ dir
   - `mind_pane` — tmux pane ID of the Mind (for drone completion signals)

3. **Wait and verify**: Wait 5 seconds, then capture the drone pane to confirm Claude started.

   ```bash
   sleep 5 && tmux capture-pane -t <drone_pane> -p | tail -10
   ```

4. **Report**:

   ```
   🛸 Drone launched

   Mind:      @{MIND_NAME}
   Ticket:    {TICKET_ID}
   Pane:      <drone_pane>
   Mind Pane: <mind_pane>
   Worktree:  <worktree>
   Branch:    <branch>

   CLAUDE.md written to: <claude_dir>/CLAUDE.md
   DRONE-BRIEF.md written to: <worktree>/DRONE-BRIEF.md

   To send the brief:
     bun minds/lib/tmux-send.ts <drone_pane> "Read DRONE-BRIEF.md and execute the tasks described."
   ```

## Sending messages to the drone

Always use `tmux-send.ts`:

```bash
bun minds/lib/tmux-send.ts <drone_pane> "your prompt text"
```

Never use raw `tmux send-keys` directly.

## Cleanup

When the drone is done, clean up all artifacts:

```bash
# Full cleanup: DRONE-BRIEF.md + private CLAUDE.md dir + worktree (--force for untracked files)
bun minds/lib/cleanup.ts all <worktree>
```
