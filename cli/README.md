# collab-workflow

CLI to scaffold the [Collab](https://github.com/BrettHamlin/collab) AI-assisted development pipeline into any git repository.

## Quick Start

```bash
# One-time install into your repo
npx collab-workflow init

# Or install globally
npm install -g collab-workflow
collab init
```

## Commands

| Command | Description |
|---------|-------------|
| `collab init` | Install Collab into the current git repo |
| `collab update` | Update an existing Collab installation |
| `collab status` | Show installed version and check for updates |

### Options

**`collab init`**
- `--force` — Overwrite existing installation
- `--skip-verify` — Skip post-installation verification
- `--quiet` — Minimal output

**`collab update`**
- `--dry-run` — Show what would change without applying
- `--force` — Update user-customizable files (with backup)

## What Gets Installed

Running `collab init` scaffolds the following into your repo:

```
.claude/
  commands/        # /collab.* slash commands for Claude Code
  skills/          # BlindQA, SpecCreator, SpecCritique skills
  settings.json    # Claude Code settings (skip if exists)

.collab/
  config/          # pipeline.json, verify config, gate prompts
  handlers/        # Signal emission TypeScript handlers
  scripts/         # verify-and-complete.ts, webhook-notify.ts
  scripts/orchestrator/  # Orchestrator command scripts
  lib/pipeline/    # Shared pipeline library
  memory/          # constitution.md (skip if exists)

.specify/
  scripts/bash/    # Feature creation + agent context scripts
  templates/       # Spec, plan, tasks, checklist templates
```

### Available Slash Commands

After `collab init`, these commands are available in Claude Code:

- `/collab.specify` — Create or update a feature spec from a Linear ticket
- `/collab.clarify` — Clarify spec requirements interactively
- `/collab.plan` — Generate an implementation plan
- `/collab.tasks` — Generate a dependency-ordered task list
- `/collab.implement` — Execute implementation tasks
- `/collab.blindqa` — Run adversarial blind QA verification
- `/collab.analyze` — Analyze spec/plan/tasks consistency
- `/collab.run` — Orchestrate the full relay pipeline
- `/collab.status` — Show pipeline status table
- `/collab.update` — Update the Collab installation

## Requirements

- **Node.js** >= 18.0.0 (for running via npx/npm)
- **[Bun](https://bun.sh)** >= 1.0 (required at runtime in the target repo for handlers and orchestrator scripts)
- **Git** repository (collab must be initialized inside a git repo)
- **Claude Code** (the AI assistant that uses the installed commands)

## Updating

```bash
collab update
```

Updates all commands, scripts, handlers, and orchestrator files to the latest version. User-customizable files (config, constitution) are preserved unless `--force` is passed.

## License

MIT
