# Multi-Repo E2E Test Runbook

**Linear ticket**: [BRE-338](https://linear.app/bretthamlin/issue/BRE-338)
**Prerequisite**: Read [knowledge-base.md](knowledge-base.md) first. BRE-337 (single-repo) should pass before running this.

---

## Purpose

Validates multi-repo orchestration — two repos, two tickets, parallel agents. Run after ANY multi-repo or orchestration changes. Permanent, reusable test.

---

## Test Environment

| Item | Value |
|------|-------|
| Orchestrator repo | Hugo at `~/Code/test-repos/hugo/`, branch `collab-e2e-testing` |
| Repo 1 (backend) | Hono at `~/Code/test-repos/multi-repo-hono/` (repo_id: `hono`) |
| Repo 2 (frontend) | Preact at `~/Code/test-repos/multi-repo-preact/` (repo_id: `preact`) |
| Feature tickets | BRE-342 (Hono rate limiter), BRE-341 (Preact rate limit hook) |
| Multi-repo config | `~/Code/test-repos/hugo/.collab/config/multi-repo.json` |
| Worktrees dir | `~/Code/test-repos/worktrees/` |

### Required config files

**multi-repo.json** (must exist at `hugo/.collab/config/multi-repo.json`):
```json
{
  "repos": {
    "hono": { "path": "/Users/atlas/Code/test-repos/multi-repo-hono" },
    "preact": { "path": "/Users/atlas/Code/test-repos/multi-repo-preact" }
  }
}
```

**Metadata files** (must exist in `hugo/specs/`):
- `specs/BRE-342/metadata.json`: `{"ticket_id":"BRE-342","repo_id":"hono"}`
- `specs/BRE-341/metadata.json`: `{"ticket_id":"BRE-341","repo_id":"preact"}`

---

## Pre-Test Cleanup (MUST do every run)

```bash
# 1. Remove worktrees from BOTH repos
cd ~/Code/test-repos/multi-repo-hono
git worktree list  # note non-main entries
git worktree remove /path/to/worktree --force  # for each
git branch -D branch-name  # for each

cd ~/Code/test-repos/multi-repo-preact
git worktree list
git worktree remove /path/to/worktree --force
git branch -D branch-name

# 2. Clean pipeline state
cd ~/Code/test-repos/hugo
rm -f .collab/state/pipeline-registry/*.json
rm -f .collab/state/signal-queue/*.json

# 3. Reset metadata (remove worktree_path, keep ticket_id and repo_id)
echo '{"ticket_id":"BRE-342","repo_id":"hono"}' > specs/BRE-342/metadata.json
echo '{"ticket_id":"BRE-341","repo_id":"preact"}' > specs/BRE-341/metadata.json

# 4. Remove stale numbered spec dirs
# rm -rf specs/001-*/  specs/002-*/  etc.
# Do NOT remove specs/BRE-341/ or specs/BRE-342/ (metadata lives there)

# 5. Verify multi-repo.json exists
cat .collab/config/multi-repo.json

# 6. Verify both repos build
cd ~/Code/test-repos/multi-repo-hono && bun install && bun test
cd ~/Code/test-repos/multi-repo-preact && npm install && npm test
```

---

## Launch Procedure

```bash
# 1. Create tmux window
tmux new-window -t 15 -n bre-338-test -c ~/Code/test-repos/hugo

# 2. Get pane ID
tmux list-panes -t 15:bre-338-test -F '#{pane_id}'

# 3. Launch Claude Code (3-step pattern)
tmux send-keys -t %PANE_ID "claude --dangerously-skip-permissions"
sleep 1
tmux send-keys -t %PANE_ID C-m

# 4. Wait ~10 seconds

# 5. Start pipeline with COLON SYNTAX (per-ticket pipelines)
tmux send-keys -t %PANE_ID "/collab.run BRE-342:default BRE-341:default"
sleep 1
tmux send-keys -t %PANE_ID C-m
```

**Colon syntax**: `BRE-342:default BRE-341:default` specifies per-ticket pipelines. Each ticket can have a different pipeline (e.g., `BRE-342:default BRE-341:mobile`).

---

## Expected Behavior

### Setup phase (orchestrator does automatically):

1. Reads multi-repo.json, resolves repo paths for each ticket
2. Runs `/collab.specify` for each ticket — creates worktrees in target repos
3. Persists `worktree_path` to metadata.json
4. Spawns agent panes: first splits horizontally (side-by-side), second splits vertically (stacked on right)
5. Creates registry files, dispatches clarify to both agents

### Pane layout (3 panes):

```
┌──────────────────┬──────────────────┐
│                  │  BRE-342 agent   │
│  Orchestrator    │  (Hono worktree) │
│  (narrow)        ├──────────────────┤
│                  │  BRE-341 agent   │
│                  │  (Preact worktree)│
└──────────────────┴──────────────────┘
```

---

## Expected Pipeline Flow

Both tickets run the same flow in parallel:

```
clarify → plan → plan_review (gate) → tasks → analyze → analyze_review (gate)
→ implement (N sub-phases) → codeReview (inline) → blindqa → done
```

### Key validations

| Check | What to verify |
|-------|---------------|
| Agent working dirs | BRE-342 in Hono worktree, BRE-341 in Preact worktree |
| Signal flow | Signals from both agents received by orchestrator |
| Signal persistence | Signals written to `.collab/state/signal-queue/` before tmux send |
| Parallel execution | Both agents progress independently |
| codeReview → blindqa | **CRITICAL**: after codeReview PASS, goes to blindqa NOT tasks |
| Registry cleanup | Both .json files deleted when each reaches done |

---

## Monitoring

```bash
# Check both registries
for ticket in BRE-342 BRE-341; do
  echo "=== $ticket ==="
  cat ~/Code/test-repos/hugo/.collab/state/pipeline-registry/$ticket.json 2>/dev/null \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
ph=d.get('implement_phase_plan',{})
impl=sum(1 for h in d['phase_history'] if h['phase']=='implement' and h['signal']=='IMPLEMENT_COMPLETE')
print(f'step={d[\"current_step\"]}, impl={impl}/{ph.get(\"total_phases\",\"-\")}')
" 2>/dev/null || echo "  (not found or done)"
done

# Pipeline complete when BOTH registry files are gone
ls ~/Code/test-repos/hugo/.collab/state/pipeline-registry/
# Empty = both done
```

---

## On Failure

1. **Stop** — do NOT push forward
2. **Diagnose**: read orchestrator + both agent outputs, both registries (see [knowledge-base.md](knowledge-base.md#diagnosing-failures))
3. **Fix**: send to dev pane (see [knowledge-base.md](knowledge-base.md#making-and-deploying-fixes))
4. Rebuild: `cd ~/Code/projects/collab/cli && bun run build`
5. Reinstall: `cd ~/Code/test-repos/hugo && npx collab-workflow init --force`
6. **IMPORTANT**: Restore multi-repo.json after init --force (it may get overwritten)
7. Full cleanup → re-launch

---

## Success Criteria

- [ ] Both pipelines reach terminal `done` (both registry files deleted)
- [ ] All transitions follow expected flow for both tickets
- [ ] codeReview → blindqa for both (NOT back to tasks)
- [ ] Agents work in correct repo worktrees
- [ ] Signal persistence works (no lost signals during compaction)
- [ ] Zero manual interventions
- [ ] No orphaned tmux panes

---

## Run History

| Date | Result | Notes |
|------|--------|-------|
| 2026-03-03 | PASS | Both tickets: 7 impl phases each, codeReview PASS, blindqa PASS, done. Validated signal persistence, colon syntax, conditional transitions, verify-and-complete.ts |
