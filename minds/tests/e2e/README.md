# E2E Mind-Drone Testing Procedure

## How to Run a Manual Mind-Drone E2E Test

### 1. Pick a test brief
Test briefs are stored in this directory. Each is a MIND-BRIEF.md work order.

| Brief | Mind | What it tests |
|-------|------|---------------|
| `cross-mind-search-brief.md` | memory | 5-task cross-mind search, complex enough to trigger feedback with Haiku drone |

### 2. Launch the Mind
```bash
bun minds/lib/mind-pane.ts \
  --mind <mind_name> \
  --ticket <ticket_id> \
  --pane $(tmux display-message -p '#{pane_id}') \
  --base <current_branch> \
  --brief-file minds/tests/e2e/<brief-file>.md
```
Returns JSON with `mind_pane`, `worktree`, `branch`.

### 3. Monitor the Mind
```bash
tmux capture-pane -p -t %<pane_id> | tail -50
```
Check every 10-15 seconds during active phases, 60s while drone is working.

### 4. What to Watch For
- **Step 1 READ**: Mind reads CLAUDE.md, MIND-BRIEF.md, MEMORY.md, and runs search-cli
- **Step 3 SPAWN**: Mind spawns drone via `Agent({ subagent_type: '🛸' })`
- **Step 6 REVIEW**: Mind reviews diff, runs tests, checks full checklist
- **Step 7 VERDICT**:
  - Issues found: Mind writes `REVIEW-FEEDBACK-{n}.md` with checklist items, resumes drone to read and fix
  - Approved: Mind writes memory, signals completion
- **Feedback file**: Confirm `REVIEW-FEEDBACK-1.md` is written with `- [ ]` checklist format
- **Drone checkoff**: Confirm drone changes `[ ]` to `[x]` as it fixes each item
- **Full re-review**: Confirm Mind runs COMPLETE checklist on re-review, not just flagged items
- **Memory write**: Confirm `bun write-cli.ts --mind <name> --content "..."` runs

### 5. Cleanup After Test
```bash
bun minds/lib/cleanup.ts all /Users/atlas/Code/projects/gravitas-<ticket>-<mind>-supervisor
git branch -D minds/<ticket>-<mind>-supervisor
tmux kill-pane -t %<pane_id>
```

### 6. No Bus Configured (Manual Tests)
When launched manually (no `--bus-url`), bus signals are skipped. This is fine for testing
the review loop. Mind will say "(bus not configured)" at signal steps.
In production `implement.ts` runs, bus is always configured and signals are control flow
for wave sequencing.

### 7. After Mind Finishes
The Mind session stays open at the Claude Code prompt after completing. It's done —
no orchestrator to kill the pane. Clean up manually.

---

## Testing the Feedback Loop

### Use Haiku as drone model
Change `.claude/agents/drone.md` from `model: sonnet` to `model: haiku`.
Haiku is less capable and more likely to produce issues the Mind will catch.
**Remember to revert to `model: sonnet` after testing.**

### Good task patterns for triggering feedback
- Complex multi-file changes (cross-mind search across 4+ files)
- Tasks requiring reading existing patterns (DRY, paths.ts contract)
- Tasks with subtle constraints buried in the requirements (T5-style display name lookup)
- Sonnet almost always passes first try — Haiku reliably triggers feedback

### What the feedback loop looks like
1. Mind finds issues in step 6 REVIEW
2. Mind writes `REVIEW-FEEDBACK-{n}.md` at worktree root with checklist format
3. Mind resumes drone: tells it to read the feedback file and check off items
4. Drone reads `REVIEW-FEEDBACK-{n}.md`, fixes each issue, marks `[x]`
5. Mind runs FULL re-review (complete checklist, not just flagged items)
6. Repeat or approve

---

## Key Files
- `minds/lib/mind-pane.ts` — Mind launcher + CLAUDE.md assembly (Review Loop lives here)
- `minds/lib/drone-pane.ts` — Drone launcher
- `.claude/agents/drone.md` — Drone agent definition (model, tools)
- `minds/lib/cleanup.ts` — Worktree cleanup utility
- `minds/cli/commands/implement.ts` — Full orchestrator (multi-wave, bus-based)

## Test Results

### cross-mind-search-brief.md
- **RF1** (2026-03-10, Haiku): 1 issue found (async Bun.file bug), feedback loop fired, drone fixed, approved round 2
- **RF2** (2026-03-10, Haiku): 4 issues found (double-merge, provider N times, DRY, misleading test), feedback loop fired, all fixed, approved round 2
- **RF3** (2026-03-10, Haiku): 5 issues found (directory filtering, provider cache, minds.json path, missing tests, null vs undefined), feedback loop fired, all fixed, approved round 2
