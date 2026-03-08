---
description: Create a worktree and launch a Claude Code Sonnet drone for Minds work. Writes the drone's private CLAUDE.md and DRONE-BRIEF.md before launching. Replaces /dev.pane for Minds development.
---

> **IMPORTANT:** Execute these steps directly and sequentially. Do NOT wrap this workflow in PAI Algorithm phases, ISC criteria, capability selection, or any other meta-framework. Follow the numbered steps exactly as written.

## Arguments

`$ARGUMENTS` — Required: `{mind_name} {ticket_id}`. Example: `pipeline_core BRE-123`

## Purpose

Launch a dedicated drone pane for a specific Mind+ticket pair. Unlike `/dev.pane`, this command:
- Writes the drone's private CLAUDE.md **before** Claude Code starts (so context is available from first token)
- Writes DRONE-BRIEF.md before launching
- Handles worktree `.git` file correctly (it's a file in worktrees, not a directory)
- Does **not** install collab or pipeline packs (Minds drones work in the collab repo directly)
- Names the worktree predictably: `collab-dev-{ticket_id}-{mind_name}`

## Steps

1. **Parse arguments**: Extract `mind_name` and `ticket_id` from `$ARGUMENTS`.

   ```bash
   MIND_NAME="<first token of $ARGUMENTS>"
   TICKET_ID="<second token of $ARGUMENTS>"
   ```

   If either is missing, stop and ask for both.

2. **Load mind profile**: Read the Mind's profile documents to build context.

   ```bash
   # Shared standards for all drones
   cat minds/STANDARDS.md

   # Mind-specific profile (if it exists)
   [ -f minds/${MIND_NAME}/MIND.md ] && cat minds/${MIND_NAME}/MIND.md

   # Minds registry (to get domain, owns_files, etc.)
   cat .collab/minds.json | jq --arg name "${MIND_NAME}" '.[] | select(.name == $name)'
   ```

   If `.collab/minds.json` does not exist, run `bun minds/generate-registry.ts` first.

3. **Build drone CLAUDE.md content**: This file is written to the drone's private context dir before Claude starts, so it reloads automatically on compaction.

   Write the content to a temp file:

   ```bash
   cat > /tmp/drone-claude-${TICKET_ID}-${MIND_NAME}.md << 'EOF'
   ## Mind Identity

   You are the @{MIND_NAME} drone for ticket {TICKET_ID}.
   Domain: {domain from minds.json}

   Your file boundary (only touch files in these paths):
   {owns_files list from minds.json}

   ## Engineering Standards
   {full content of minds/STANDARDS.md}

   ## Mind Profile (@{MIND_NAME})
   {full content of minds/{MIND_NAME}/MIND.md, if it exists — omit section if file not found}

   ## Active Task
   Your current task brief is in DRONE-BRIEF.md at the worktree root.
   If you've compacted or lost context, re-read that file.
   EOF
   ```

4. **Build DRONE-BRIEF.md content**: If tasks.md exists for this ticket, include the Mind's tasks. Otherwise write a placeholder.

   Resolve the feature directory:

   ```bash
   FEATURE_JSON=$(bun minds/execution/resolve-feature.ts --ticket ${TICKET_ID} 2>/dev/null || echo "NO_FEATURE_DIR")
   ```

   If `FEATURE_JSON` is `NO_FEATURE_DIR`, write a placeholder brief:

   ```bash
   cat > /tmp/drone-brief-${TICKET_ID}-${MIND_NAME}.md << 'EOF'
   # Drone Brief — @{MIND_NAME} for {TICKET_ID}

   No tasks.md found yet. The Mind will send your task brief via the pane.

   When tasks arrive:
   - Read DRONE-BRIEF.md (this file will be updated)
   - Implement only files within your owned paths
   - Report DRONE_COMPLETE @{MIND_NAME} {TICKET_ID} when done
   EOF
   ```

   If tasks.md exists, extract tasks for this Mind and write the full brief (same format as implement.md step 6b).

5. **Launch the drone pane**: Call the TypeScript implementation, passing the content files.

   ```bash
   echo $TMUX_PANE
   bun minds/lib/drone-pane.ts \
     --mind ${MIND_NAME} \
     --ticket ${TICKET_ID} \
     --pane $TMUX_PANE \
     --claude-file /tmp/drone-claude-${TICKET_ID}-${MIND_NAME}.md \
     --brief-file /tmp/drone-brief-${TICKET_ID}-${MIND_NAME}.md
   ```

   Parse the JSON output:
   - `drone_pane` — tmux pane ID of the new drone
   - `worktree` — absolute path to the worktree
   - `branch` — branch name (`minds/{TICKET_ID}-{MIND_NAME}`)
   - `base` — base branch
   - `claude_dir` — path to the drone's private ~/.claude/projects/ dir

6. **Wait and verify**: Wait 5 seconds, then capture the drone pane to confirm Claude started.

   ```bash
   sleep 5 && tmux capture-pane -t <drone_pane> -p | tail -10
   ```

7. **Report**:

   ```
   🛸 Drone launched

   Mind:     @{MIND_NAME}
   Ticket:   {TICKET_ID}
   Pane:     <drone_pane>
   Worktree: <worktree>
   Branch:   <branch>

   CLAUDE.md written to: <claude_dir>/CLAUDE.md
   DRONE-BRIEF.md written to: <worktree>/DRONE-BRIEF.md

   To send the brief:
     bun ~/.claude/bin/tmux-send.ts <drone_pane> "Read DRONE-BRIEF.md and execute the tasks described."
   ```

## Sending messages to the drone

Always use `tmux-send.ts`:

```bash
bun ~/.claude/bin/tmux-send.ts <drone_pane> "your prompt text"
```

Never use raw `tmux send-keys` directly.

## Cleanup

When the drone is done, clean up all artifacts:

```bash
# Full cleanup: DRONE-BRIEF.md + private CLAUDE.md dir + worktree (--force for untracked files)
bun minds/lib/cleanup.ts all <worktree>
```
