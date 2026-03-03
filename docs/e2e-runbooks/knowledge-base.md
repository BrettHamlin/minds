# Collab E2E Testing: System Knowledge Base

Read this before running any E2E test. This is the source of truth — the Linear document mirrors this file.

**Linear mirror**: [Collab E2E Testing: System Knowledge Base](https://linear.app/bretthamlin/document/collab-e2e-testing-system-knowledge-base-78bc662a2f9b)

---

## What is Collab?

Collab is a **pipeline orchestration system for Claude Code**. It drives autonomous software development by:

1. Reading a Linear ticket ID
2. Spawning a Claude Code agent in a tmux pane
3. Walking the agent through phases: clarify → plan → review → tasks → analyze → implement → codeReview → blindqa → done
4. Each phase produces artifacts (spec.md, plan.md, tasks.md, analysis.md, code changes)
5. Gates between phases evaluate quality and can reject/retry
6. The orchestrator (another Claude Code instance) manages transitions, signals, and state

**The orchestrator is a Claude Code session running `/collab.run`.** It reads `pipeline.json` for phase definitions, dispatches work to the agent via tmux, and listens for completion signals.

---

## Architecture Overview

```
User runs: /collab.run BRE-339 --pipeline default

┌─────────────────────┐     signals      ┌─────────────────────┐
│   ORCHESTRATOR      │ ◄──────────────► │      AGENT          │
│   (Claude Code)     │   tmux send      │   (Claude Code)     │
│                     │                  │                     │
│ Reads pipeline.json │                  │ Runs /collab.clarify│
│ Manages registry    │                  │ Runs /collab.plan   │
│ Evaluates gates     │                  │ Runs /collab.implement│
│ Dispatches phases   │                  │ Emits signals       │
└─────────────────────┘                  └─────────────────────┘
        │                                         │
        ▼                                         ▼
.collab/state/pipeline-registry/BRE-339.json    specs/BRE-339/
(current_step, phase_history,                   (spec.md, plan.md,
 implement_phase_plan)                           tasks.md, analysis.md)
```

### Signal Flow

1. Agent completes a phase (e.g., clarify)
2. Agent runs `bun .collab/scripts/verify-and-complete.ts` which validates completion
3. Script writes signal to `.collab/state/signal-queue/{ticket_id}.json`
4. Script sends signal to orchestrator pane via tmux send-keys
5. Orchestrator reads signal, resolves next transition, dispatches next phase

### Pipeline Configuration

- `.collab/config/pipeline.json` — compiled pipeline definition (phases, transitions, gates, conditionalTransitions)
- `.collab/config/pipeline.compiled.schema.json` — JSON schema for validation
- `.collab/config/gates/*.md` — gate evaluation prompts

### Registry (State Tracking)

`.collab/state/pipeline-registry/{TICKET_ID}.json` tracks:

| Field | Purpose |
|-------|---------|
| `current_step` | Current phase name |
| `phase_history` | Array of `{phase, signal, ts}` for every completed phase |
| `implement_phase_plan` | `{current_phase, total_phases, phases: [...]}` for phased implementation |
| `code_review_attempts` | Retry count for codeReview |
| `orchestrator_pane_id` | Orchestrator tmux pane ID |
| `agent_pane_id` | Agent tmux pane ID |
| `nonce` | Unique run identifier |

Registry file is **DELETED** when pipeline reaches `done` (absence = success).

---

## Collab Source Architecture

**Source repo**: `~/Code/projects/collab/`
**Key branches**: `dev` (main development), `multi-repo` (multi-repo features), `cleanup` (single-repo fixes)

### Directory Structure

```
src/
├── commands/           # Orchestrator and agent command files (.md)
│   ├── collab.run.md           # THE orchestrator brain — drives entire pipeline
│   ├── collab.clarify.md       # Agent: clarify phase
│   ├── collab.plan.md          # Agent: plan phase
│   ├── collab.implement.md     # Agent: implement phase
│   ├── collab.analyze.md       # Agent: analyze phase
│   ├── collab.codeReview.md    # Agent: inline code review subagent
│   ├── collab.blindqa.md       # Agent: blind QA phase
│   └── collab.specify.md       # Orchestrator: creates worktree + spec scaffold
├── config/
│   ├── pipeline.v3.schema.json # Source schema
│   └── gates/                  # Gate evaluation prompts
├── scripts/
│   ├── verify-and-complete.ts  # Phase completion + signal emission
│   └── orchestrator/
│       ├── commands/
│       │   ├── orchestrator-init.ts      # Pipeline init (spawn pane, registry)
│       │   ├── transition-resolve.ts     # Phase transition resolution
│       │   └── coordination-check.ts     # Multi-ticket dependency detection
│       └── ...
├── lib/
│   └── pipeline/
│       ├── transitions.ts       # Core transition logic (resolveTransition)
│       ├── registry.ts          # Registry read/write helpers
│       └── index.ts             # Shared utilities
└── hooks/                       # Signal and question hooks

cli/                             # CLI package (npx collab-workflow)
├── src/
│   ├── templates/               # *** MIRRORS src/ — MUST stay in sync ***
│   │   ├── commands/            # Same .md files as src/commands/
│   │   ├── scripts/             # Same scripts as src/scripts/
│   │   ├── config/              # Same config files
│   │   └── hooks/               # Same hooks
│   └── installer.ts             # Deploys templates to target repo .collab/
└── dist/                        # Built bundle
```

### CRITICAL: Dual Template Structure

Every file in `src/` has a mirror in `cli/src/templates/`. When you change a source file:

1. Edit `src/commands/collab.run.md`
2. **ALSO** edit `cli/src/templates/commands/collab.run.md` (identical change)
3. Rebuild CLI: `cd cli && bun run build`
4. Reinstall in test repo: `cd ~/Code/test-repos/hugo && npx collab-workflow init --force`

**If you only change one side, the fix won't deploy to test repos.**

---

## Key Files Reference

| File | What it does | When you need it |
|------|-------------|-----------------|
| `src/commands/collab.run.md` | Orchestrator brain — all transition logic, gate evaluation, phase dispatch | Any orchestrator behavior issue |
| `src/lib/pipeline/transitions.ts` | Resolves which phase comes next given current phase + signal | Wrong phase transitions |
| `src/scripts/verify-and-complete.ts` | Validates phase completion, emits signals | Signal not received, phase not completing |
| `src/scripts/orchestrator/commands/orchestrator-init.ts` | Spawns agent pane, creates registry, sets up symlinks | Agent not spawning, wrong working directory |
| `src/commands/collab.implement.md` | Agent implement phase — handles phased implementation | Implementation issues, phase counting |
| `src/commands/collab.codeReview.md` | Inline code review subagent | Code review not firing or wrong verdict |
| `cli/src/installer.ts` | Deploys templates to target repo | Files not deploying after init |

---

## Diagnosing Failures

### Symptom → Cause → Fix

**Agent not responding to dispatched phase:**
- Check: `tmux capture-pane -t %AGENT_PANE -p | tail -20`
- Common cause: Agent hit context limit (compacted), lost the dispatched command
- Fix: Re-send the phase command via tmux send-keys

**Signal not received by orchestrator:**
- Check: `ls .collab/state/signal-queue/` — is signal file there?
- Check: `tmux capture-pane -t %ORCH_PANE -p | tail -20` — is orchestrator waiting?
- Common cause: Orchestrator compacted and lost signal
- Fix: Re-send signal: `tmux send-keys -t %ORCH_PANE "SIGNAL: {TICKET_ID} {SIGNAL_NAME}"` + sleep 1 + C-m

**Wrong phase transition (e.g., goes to tasks instead of blindqa):**
- Check registry: `cat .collab/state/pipeline-registry/{TICKET}.json | python3 -m json.tool`
- Check: `bun .collab/scripts/orchestrator/transition-resolve.ts {current_phase} {signal}`
- Root cause usually in `transitions.ts` or `collab.run.md` step c
- `conditionalTransitions` with `"if":"hasGroup"` means "if implement has remaining phases, go back to tasks; otherwise go to blindqa"

**Agent spawns in wrong directory:**
- Check: worktree path in metadata.json vs registry
- Root cause: `orchestrator-init.ts` resolves from metadata.json `worktree_path` and multi-repo.json `repo_id`
- Priority: worktree > repoPath > current directory

**Gate keeps rejecting:**
- Registry `retry_count` increments each rejection
- Normal: analyze_review may retry 1-2 times with escalation
- Abnormal: 3+ retries suggests gate prompt or analysis quality issue

### General debugging approach

1. Read orchestrator pane output (last 30-50 lines)
2. Read agent pane output (last 30-50 lines)
3. Read registry JSON (current_step, phase_history, implement_phase_plan)
4. Check signal queue for pending signals
5. If transition issue: run `transition-resolve.ts` manually
6. If signal issue: check verify-and-complete.ts output in agent pane

---

## Making and Deploying Fixes

1. Diagnose the issue (see above)
2. Identify which source file needs changing
3. Send fix instructions to dev pane (tmux 3-step pattern)
4. Dev pane makes the change in BOTH `src/` and `cli/src/templates/`
5. Dev pane commits and runs `bun test` (883+ tests must pass)
6. Rebuild: `cd ~/Code/projects/collab/cli && bun run build`
7. Reinstall: `cd ~/Code/test-repos/hugo && npx collab-workflow init --force`
8. (Multi-repo only) Restore multi-repo.json if overwritten by init --force
9. Full cleanup then re-launch test

---

## The Delegation Model

**The E2E runner does NOT edit collab source directly.** Instead:

1. Diagnose the failure
2. Craft clear, specific fix instructions
3. Send to a **dev pane** (another Claude Code session in the collab source repo)
4. Dev pane implements, tests, commits, rebuilds
5. Reinstall in test repo and re-run

The dev pane should be a Claude Code session in `~/Code/projects/collab/` on the appropriate branch.

---

## Tmux Communication Pattern

**ALWAYS 3 separate commands:**

```bash
tmux send-keys -t %PANE_ID "your message here"
sleep 1
tmux send-keys -t %PANE_ID C-m
```

- NEVER combine text and C-m in one send-keys call
- NEVER use `Enter` — always `C-m`
- Always `sleep 1` between text and C-m
- Copy-mode stuck: `tmux send-keys -t %PANE_ID -X cancel`
- Verify pane exists: `tmux list-panes -a -F '#{pane_id}' | grep %PANE_ID`

---

## Pause/Resume

```bash
# Pause
tmux send-keys -t %ORCH_PANE "PAUSE" && sleep 1 && tmux send-keys -t %ORCH_PANE C-m

# Resume
tmux send-keys -t %ORCH_PANE "RESUME" && sleep 1 && tmux send-keys -t %ORCH_PANE C-m
```

---

## Historically Fixed Bugs

| # | Bug | Fix |
|---|-----|-----|
| 1 | ajv dependency crash in non-Node repos | Graceful skip when ajv CLI missing |
| 2 | Skill tool boundary — `/collab.codeReview` and `/collab.specify` | Execute inline (read .md), NOT via Skill tool (creates response boundary) |
| 3 | Compiled schema missing codeReview | Added codeReview definitions to schema |
| 4 | `--pipeline` flag leaking to agent scripts | Parse Arguments section strips it |
| 5 | Signal hook not registered | Installer deploys signal/question hooks |
| 6 | `.specify/` not symlinked in worktree | Added to symlink array in orchestrator-init.ts |
| 7 | `git diff HEAD~1` vs `HEAD` | Use `git diff HEAD` (uncommitted changes) |
| 8 | codeReview → tasks loop | Conditional transition evaluation in collab.run.md step c + transitions.ts plainOnly fallback |
| 9 | Agent spawns in source repo not worktree | Worktree path takes priority |
| 10 | `init --force` overwrites multi-repo.json | Backup/restore after install |
| 11 | Signal lost during compaction | Signals persist to file before tmux send |
| 12 | verify-and-complete.sh still bash | Converted to TypeScript (.ts) |
