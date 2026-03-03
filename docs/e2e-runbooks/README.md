# E2E Testing Runbooks

End-to-end test procedures for validating collab pipeline changes. Run these after ANY source changes before declaring production-ready.

## Fastest Way: E2ETester Agent

There is a custom Claude Code agent that automates the entire E2E test process. It sets up its own workspace, runs the test, monitors every transition, and delegates fixes autonomously.

**To use it**, spawn it from any Claude Code session:

> "Spawn an E2ETester to run BRE-337"

Or just:

> "Run the E2E test"

The agent will:
1. Ask you 3 questions (which test, which feature ticket, which branch)
2. Set up a workspace: 🧠 (brain/monitor), 🛸 (dev pane for fixes), 🎯 (test window)
3. Run cleanup, launch the pipeline, monitor every transition
4. On failure: diagnose, send fix instructions to 🛸, rebuild, re-run

**Agent files:**
- Definition: `~/.claude/agents/E2ETester.md`
- Knowledge base: `~/.claude/skills/Agents/E2ETesterContext.md`

If you prefer to run tests manually, use the runbooks below.

---

## Runbooks

| Runbook | Linear Ticket | What it validates |
|---------|--------------|-------------------|
| [Single-Repo](single-repo.md) | BRE-337 | Full pipeline flow in one repo (Hugo) |
| [Multi-Repo](multi-repo.md) | BRE-338 | Two-repo orchestration with parallel agents |

## Prerequisites

- Read [knowledge-base.md](knowledge-base.md) first — covers collab architecture, source structure, diagnosis patterns, and the fix workflow
- Collab source at `~/Code/projects/collab/` on `dev` branch
- tmux session available
- Claude Code installed

## Execution Order

1. **Always run single-repo first** (BRE-337) — validates core pipeline
2. **Then multi-repo** (BRE-338) — validates orchestration layer
3. Both must pass before merging to `main`

## Quick Reference

```bash
# Rebuild CLI after source changes
cd ~/Code/projects/collab/cli && bun run build

# Install to test repo
cd ~/Code/test-repos/hugo && npx collab-workflow init --force

# Run collab tests
cd ~/Code/projects/collab && bun test
```
