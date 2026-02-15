# CollabAI Workflow System - Source Files

This directory contains the source files for the Collab workflow system, a comprehensive feature development pipeline with autonomous orchestration capabilities.

## Structure

```
src/
├── commands/                       # Claude Code command files
│   ├── relay.install.md           # Install collab into any repo from GitHub
│   ├── relay.pipeline.md          # Autonomous orchestrator (tmux multi-agent)
│   ├── relay.specify.md           # Create feature specification
│   ├── relay.clarify.md           # Clarify spec ambiguities
│   ├── relay.plan.md              # Generate implementation plan
│   ├── relay.tasks.md             # Break plan into tasks
│   ├── relay.analyze.md           # Analyze spec/plan/tasks consistency
│   ├── relay.implement.md         # Execute implementation
│   ├── relay.checklist.md         # Generate quality checklist
│   ├── relay.constitution.md      # Manage project principles
│   ├── relay.taskstoissues.md     # Convert tasks to GitHub issues
│   └── relay.blindqa.md           # Blind verification testing
├── handlers/                       # Signal emission utilities
│   ├── pipeline-signal.ts         # Shared signal utilities
│   ├── emit-question-signal.ts    # CLARIFY_QUESTION signal emitter
│   └── emit-blindqa-signal.ts     # BlindQA lifecycle signal emitter
└── scripts/
    └── orchestrator/               # Pipeline orchestration scripts
        ├── orchestrator-init.sh   # Initialize agent registry
        ├── signal-validate.sh     # Parse and validate signals
        ├── registry-read.sh       # Read registry file
        ├── registry-update.sh     # Update registry atomically
        ├── phase-advance.sh       # Calculate next phase
        ├── group-manage.sh        # Manage ticket coordination groups
        ├── status-table.sh        # Display orchestrator status
        └── Tmux.ts                # Tmux automation CLI
```

## Installation

Install collab into any repository using the global installation command:

```bash
/collab.install
```

This command:
1. Clones collab from GitHub (dev branch)
2. Copies all files into the current repository:
   - Commands → `.claude/commands/`
   - Handlers → `.collab/handlers/`
   - Orchestrator scripts → `.collab/scripts/orchestrator/`
   - Workflow scripts → `.specify/scripts/`
   - Templates → `.specify/templates/`
3. Creates state directories (`.collab/state/pipeline-registry`, `.collab/state/pipeline-groups`)
4. Sets executable permissions
5. Preserves existing constitution if present

**Result:** Each repository gets a complete, self-contained collab installation with zero global dependencies.

## Architecture

### Repo-Local Design

Relay uses a **fully local architecture**:
- All commands auto-discovered from `.claude/commands/`
- All handlers in `.collab/handlers/`
- All orchestrator scripts in `.collab/scripts/orchestrator/`
- Pipeline state in `.collab/state/pipeline-registry/`
- No symlinks, no global paths, no shared dependencies

### Pipeline Orchestration

The `/collab.run` command provides autonomous workflow orchestration:

```
Phase Progression:
clarify → plan → tasks → analyze → implement → blindqa → done

Orchestration Pattern:
- Spawns agent panes in tmux splits
- Signal-driven phase advancement
- AI quality gates (plan review, analyze review, implementation validation)
- Deployment coordination for grouped tickets
- Blind verification with retry loop
```

### Signal Emission Architecture

Commands use **deterministic signal emission** for orchestrator integration:

```
Domain Logic (Command) → Signal Emitter (Handler) → Orchestrator
Example: relay.clarify → emit-question-signal.ts → relay.pipeline
```

**Shared Infrastructure (pipeline-signal.ts):**
- `mapResponseState()` - Maps state + phase to signal type
- `buildSignalMessage()` - Formats signals for orchestrator consumption
- `resolveRegistry()` - Finds current ticket's registry file
- `truncateDetail()` - Truncates detail text for signal format

### Registry Architecture

Pipeline registry files store agent state locally:

```
.collab/state/pipeline-registry/{ticket_id}.json
```

Format:
```json
{
  "ticket_id": "BRE-191",
  "nonce": "abc123",
  "current_step": "clarify",
  "orchestrator_pane_id": "%0.0",
  "agent_pane_id": "%0.1",
  "worktree_path": "/path/to/worktree",
  "group_id": "group-abc123"
}
```

## Commands Overview

| Command | Purpose | Orchestrated |
|---------|---------|--------------|
| **relay.install** | Install collab into current repo | No |
| **relay.pipeline** | Autonomous orchestrator | Yes (driver) |
| **relay.specify** | Create feature specification | No |
| **relay.clarify** | Clarify spec ambiguities | Yes (emits signals) |
| **relay.plan** | Generate implementation plan | No |
| **relay.tasks** | Break plan into tasks | No |
| **relay.analyze** | Analyze consistency | No |
| **relay.implement** | Execute implementation | No |
| **relay.blindqa** | Blind verification | Yes (emits signals) |
| **relay.checklist** | Generate quality checklist | No |
| **relay.constitution** | Manage project principles | No |
| **relay.taskstoissues** | Convert tasks to GitHub issues | No |

## Design Decisions

### Why Deterministic Signal Emission?

**Problem:** Hook-based signal emission was unreliable (race conditions, missed signals, unpredictable timing)

**Solution:** Explicit Bash calls at precise workflow moments

**Benefits:**
- ✅ Explicit control over signal timing
- ✅ Deterministic (same code path = same signals)
- ✅ Verifiable (signals visible in command file)
- ✅ No race conditions
- ✅ Commands remain clean and reusable

### Why Repo-Local Installation?

**Benefits:**
- ✅ Zero global dependencies - each repo is self-contained
- ✅ Version control - collab evolves with the project
- ✅ Isolation - different projects can use different collab versions
- ✅ Collaboration - team shares exact same collab installation
- ✅ Portability - clone repo, run `/collab.install`, ready to go

## Version Control

This repository is the **source of truth** for relay. Updates are distributed via:
1. Push changes to GitHub (dev branch)
2. Users run `/collab.install` in their repos to update
3. Installation clones latest from GitHub and copies files locally

## Development Workflow

To modify collab:
1. Make changes in this repository
2. Test locally: `cd /path/to/test-repo && /collab.install`
3. Commit and push to dev branch
4. Other repos update by re-running `/collab.install`
