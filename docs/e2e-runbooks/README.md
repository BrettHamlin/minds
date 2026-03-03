# E2E Testing Runbooks

End-to-end test procedures for validating collab pipeline changes. Run these after ANY source changes before declaring production-ready.

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
