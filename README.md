# Gravitas — Minds

A modular AI agent system that installs into any repo. Each Mind owns a domain (routing, memory, signals, etc.) and operates independently, coordinating through typed interfaces.

## Quick Start

### Requirements

- [Bun](https://bun.sh) >= 1.0
- [tmux](https://github.com/tmux/tmux)
- [Claude Code](https://claude.ai/code)
- Git

### Install into your repo

```bash
cd /path/to/your-repo
bun /path/to/gravitas/minds/cli/bin/minds.ts init
```

This creates:
- `.minds/` — 8 portable Minds + shared infrastructure
- `.claude/commands/` — slash commands (`/minds.tasks`, `/minds.implement`)
- `tsconfig.json` — updated with `@minds/*` path alias
- Dashboard SPA — built and ready to serve

### Generate tasks for a ticket

```
/minds.tasks BRE-123
```

Reads your plan and spec from `specs/BRE-123/`, identifies which Minds are involved, and generates tasks scoped to each Mind's domain. Output: `specs/BRE-123/tasks.md`.

### Implement tasks

```
/minds.implement BRE-123
```

Dispatches each Mind's tasks to a dedicated drone (Claude Code Sonnet in a tmux pane + git worktree). Drones work in parallel on their own files, coordinating through interface contracts.

### Scaffold a new Mind

From inside Claude Code in your repo:

```
/minds.tasks "Create a new Mind called analytics for tracking user events"
```

Or use the instantiate Mind directly — it creates the directory structure (`MIND.md`, `server.ts`, `lib/`) and registers in `minds.json`.

## What Gets Installed

| Component | Path | Purpose |
|-----------|------|---------|
| 8 Minds | `.minds/{router,memory,transport,signals,dashboard,integrations,observability,instantiate}/` | Core agent modules |
| Shared infra | `.minds/shared/`, `.minds/contracts/` | Types, paths, interfaces |
| Orchestration | `.minds/lib/` | Drone pane management, bus messaging |
| Commands | `.claude/commands/minds.*.md` | Slash commands for Claude Code |
| Registry | `.minds/minds.json` | Mind discovery and routing |
| Dashboard | `.minds/dashboard/dist/` | Live status SPA |

## Architecture

Each Mind is a self-contained module with:
- `MIND.md` — domain definition, conventions, review focus
- `server.ts` — MCP server entry point
- `lib/` — implementation code

Minds communicate through typed interfaces defined in `minds.json` (`exposes`/`consumes`). The router Mind handles intent classification and dispatch.

## Dashboard

The dashboard shows live drone status via SSE. To start it:

```bash
bun .minds/transport/status-aggregator.ts
```

Then open `http://localhost:<port>/minds` in your browser.

## Development (this repo)

```bash
# Run all tests
bun test

# Install into a target repo (from gravitas root)
bun minds/cli/bin/minds.ts init /path/to/target-repo
```

## License

MIT
