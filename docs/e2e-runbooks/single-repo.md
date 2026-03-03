# Single-Repo E2E Test Runbook

**Linear ticket**: [BRE-337](https://linear.app/bretthamlin/issue/BRE-337)
**Prerequisite**: Read [knowledge-base.md](knowledge-base.md) first

---

## Purpose

Validates the complete collab pipeline in a single-repo setup. Run after ANY collab source changes to catch regressions. This is a permanent, reusable test — not a one-time task.

---

## Test Environment

| Item | Value |
|------|-------|
| Test repo | Hugo (gohugoio/hugo) at `~/Code/test-repos/hugo/` |
| Branch | `collab-e2e-testing` |
| Feature ticket | BRE-339 (reused every run — pipeline processes this ticket) |
| Worktrees dir | `~/Code/test-repos/worktrees/` |

---

## Pre-Test Cleanup (MUST do every run)

```bash
cd ~/Code/test-repos/hugo

# 1. Remove worktrees
git worktree list  # note any non-main entries
git worktree remove /path/to/worktree --force  # for each
git branch -D branch-name  # for each worktree branch

# 2. Clean pipeline state
rm -f .collab/state/pipeline-registry/*.json
rm -f .collab/state/signal-queue/*.json

# 3. Remove stale specs (keep BRE-341, BRE-342 metadata for multi-repo)
rm -rf specs/BRE-339/
# Also remove numbered spec dirs from previous runs:
# rm -rf specs/001-*/  etc.

# 4. Verify build
go build ./...
```

---

## Launch Procedure

```bash
# 1. Create tmux window
tmux new-window -t 15 -n bre-339-test -c ~/Code/test-repos/hugo

# 2. Get pane ID
tmux list-panes -t 15:bre-339-test -F '#{pane_id}'
# Returns e.g. %5152

# 3. Launch Claude Code (3-step tmux pattern)
tmux send-keys -t %PANE_ID "claude --dangerously-skip-permissions"
sleep 1
tmux send-keys -t %PANE_ID C-m

# 4. Wait ~10 seconds for Claude to start

# 5. Start pipeline
tmux send-keys -t %PANE_ID "/collab.run BRE-339 --pipeline default"
sleep 1
tmux send-keys -t %PANE_ID C-m
```

---

## Expected Pipeline Flow

Validate EVERY transition matches this sequence:

```
clarify → plan → plan_review (gate) → tasks → analyze → analyze_review (gate)
→ implement (N sub-phases) → codeReview (inline) → blindqa → done
```

| Phase | Signal | Verify |
|-------|--------|--------|
| clarify | CLARIFY_COMPLETE | spec.md created in worktree specs/ |
| plan | PLAN_COMPLETE | plan.md created |
| plan_review | gate: APPROVED or REVISION_NEEDED | Gate evaluates, routes correctly |
| tasks | TASKS_COMPLETE | tasks.md created with `## Phase N:` sections |
| analyze | ANALYZE_COMPLETE | analysis.md created |
| analyze_review | gate evaluates | May retry 1-2x (normal), eventually passes |
| implement | IMPLEMENT_COMPLETE (multiple) | N sub-phases, registry tracks `implement_phase_plan.current_phase/total_phases` |
| codeReview | REVIEW: PASS or FAIL | Inline subagent (NOT Skill tool). PASS → blindqa. FAIL → agent fixes, retries |
| **CRITICAL** | after codeReview PASS | **MUST go to blindqa, NOT back to tasks**. This was a fixed bug — validate it. |
| blindqa | BLINDQA_COMPLETE | QA verification passes |
| done | (terminal) | Registry file DELETED (absence = success) |

---

## Monitoring

```bash
# Check registry state (every 2-3 minutes)
cat ~/Code/test-repos/hugo/.collab/state/pipeline-registry/BRE-339.json 2>/dev/null \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
ph=d.get('implement_phase_plan',{})
impl=sum(1 for h in d['phase_history'] if h['phase']=='implement' and h['signal']=='IMPLEMENT_COMPLETE')
print(f'step={d[\"current_step\"]}, history={len(d[\"phase_history\"])}, impl={impl}/{ph.get(\"total_phases\",\"-\")}')
for h in d['phase_history']:
    print(f'  {h[\"phase\"]} -> {h[\"signal\"]}')
"

# Check orchestrator pane
tmux capture-pane -t %ORCH_PANE -p | tail -15

# Check agent pane
tmux capture-pane -t %AGENT_PANE -p | tail -15

# Pipeline complete when registry file is gone
ls ~/Code/test-repos/hugo/.collab/state/pipeline-registry/
# Empty = done
```

---

## On Failure

1. **Stop** — do NOT push forward
2. **Diagnose**: read orchestrator output, registry state, agent output (see [knowledge-base.md](knowledge-base.md#diagnosing-failures))
3. **Fix**: send instructions to dev pane (see [knowledge-base.md](knowledge-base.md#making-and-deploying-fixes))
4. After fix committed: `cd ~/Code/projects/collab/cli && bun run build`
5. Reinstall: `cd ~/Code/test-repos/hugo && npx collab-workflow init --force`
6. Re-run full cleanup, re-launch from scratch

---

## Success Criteria

- [ ] Pipeline reaches terminal `done` (registry file deleted)
- [ ] All phase transitions follow expected flow (no skips, no wrong routing)
- [ ] codeReview PASS → blindqa (NOT codeReview → tasks)
- [ ] Zero manual interventions
- [ ] No orphaned tmux panes

---

## Run History

| Date | Result | Notes |
|------|--------|-------|
| 2026-03-02 | PASS (Run #4) | clarify → plan → plan_review (APPROVED) → tasks → analyze → analyze_review (ESCALATED→REMEDIATED) → implement (3 phases) → codeReview (PASS 7/7) → blindqa (8/8 PASS) → done |
| 2026-03-03 | PASS (Run #5) | Validated conditional transition fix, verify-and-complete.ts conversion |
