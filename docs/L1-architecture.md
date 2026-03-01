# L1 — Collab Architecture Overview

**Last verified**: 2026-02-21 | **Source of truth**: Codebase at commit HEAD on `dev` branch

## What Collab Is

Collab is an **AI-powered autonomous software development pipeline** that takes a Linear ticket and produces a fully implemented, verified feature branch — with zero human intervention during execution.

It orchestrates multiple Claude Code AI agents through a structured 7-phase workflow: specification, clarification, planning, task generation, analysis, implementation, and blind QA verification. A central orchestrator drives the pipeline by monitoring signals from agents and advancing phases according to a declarative configuration.

## Two Systems in One Repository

This repository contains **two distinct systems**:

### 1. The Pipeline Orchestrator (Primary — Active)

A tmux-based workflow engine that:
- Spawns Claude Code agents in tmux split panes
- Drives them through a 7-phase pipeline defined in `pipeline.json`
- Processes signals emitted by agents to advance, retry, or gate-check phases
- Evaluates AI judgment gates (plan review, analysis review) before phase transitions
- Supports multi-ticket parallel execution with coordination/dependency management

**Technology**: Bash scripts + TypeScript (Bun runtime) + tmux + Claude Code CLI

### 2. The Relay Platform (Secondary — Planned/Partial)

A Slack-first spec creation platform where PMs describe features and AI guides them through blind QA questioning to produce complete specs. Has Express server, PostgreSQL via Drizzle ORM, Slack Block Kit integration.

**Technology**: Node.js + Express + TypeScript + PostgreSQL + Drizzle ORM + Slack Bolt

**Current state**: Server code exists (`src/index.ts`, `src/services/`, `src/routes/`, `src/plugins/slack/`) but is secondary to the pipeline orchestrator. Several plugin directories (`src/plugins/jira/`, `src/plugins/linear/`, `src/protocol/`) are empty placeholders.

## Three-Layer Architecture (Pipeline Orchestrator)

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Declarative (.collab/config/pipeline.json)           │
│  Defines: phases, commands, transitions, gates, goal gates      │
│  Changes when: workflow evolves (new phases, new transitions)   │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2 — Execution (.collab/scripts/orchestrator/)            │
│  Generic interpreters that read Layer 1 and execute it          │
│  Changes when: pipeline.json SCHEMA changes (rare)              │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3 — Judgment (.claude/commands/collab.run.md)            │
│  AI evaluates gates, chooses answers, escalates                 │
│  Changes when: judgment policies change                         │
└─────────────────────────────────────────────────────────────────┘
```

**Key design principle**: Scripts (Layer 2) are generic — they read their rules from config (Layer 1). Adding a new pipeline phase requires only a `pipeline.json` change and a new command file. Zero script modifications.

## The 7-Phase Pipeline

```
clarify → plan → [plan_review gate] → tasks → analyze → [analyze_review gate] → implement → blindqa → done
```

| Phase | Command | Purpose |
|-------|---------|---------|
| **clarify** | `/collab.clarify` | Ask domain questions to fill spec gaps |
| **plan** | `/collab.plan` | Generate implementation plan from spec |
| *plan_review* | *AI gate* | *Orchestrator evaluates plan against ticket ACs* |
| **tasks** | `/collab.tasks` | Break plan into dependency-ordered tasks |
| **analyze** | `/collab.analyze` | Cross-artifact consistency check |
| *analyze_review* | *AI gate* | *Orchestrator evaluates analysis, enforces CRITICAL fix* |
| **implement** | `/collab.implement` | Execute all tasks, write code, run tests |
| **blindqa** | `/collab.blindqa` | Independent blind verification testing |
| **done** | *terminal* | Pipeline complete, cleanup |

## Signal Protocol

Agents communicate with the orchestrator via structured signal strings:

```
[SIGNAL:{TICKET_ID}:{NONCE}] {SIGNAL_TYPE} | {detail}
```

Signal suffixes determine routing:
- `_COMPLETE` → Advance to next phase (possibly through a gate)
- `_QUESTION` / `_WAITING` → Agent needs input; orchestrator answers
- `_ERROR` / `_FAILED` → Retry current phase

## Component Inventory

| Component | Location | Language | Purpose |
|-----------|----------|----------|---------|
| Pipeline config | `src/config/pipeline.json` | JSON | Declarative workflow definition |
| Orchestrator command | `src/commands/collab.run.md` | Markdown | AI judgment instructions |
| Orchestrator scripts (13) | `src/scripts/orchestrator/*.sh` | Bash | Deterministic execution engine |
| Orchestrator TS scripts (6) | `src/scripts/orchestrator/*.ts` | TypeScript | Complex logic (validation, transitions) |
| Phase commands (15) | `src/commands/collab.*.md` | Markdown | Per-phase agent instructions |
| Signal handlers (5) | `src/handlers/*.ts` | TypeScript | Signal emission from agents |
| Skills (3) | `src/skills/{BlindQA,SpecCreator,SpecCritique}/` | Markdown | Reusable AI skill definitions |
| Go attractor | `collab/attractor/` | Go | Binary signal monitor with AI gates |
| CLI client | `cli/` | TypeScript | Standalone CLI for Relay platform |
| Express server | `src/index.ts` + `src/services/` | TypeScript | Relay platform backend |
| Templates (6) | `.specify/templates/` | Markdown | Spec/plan/tasks/checklist templates |
| Gate prompts (4) | `src/config/gates/` | Markdown | AI evaluation prompt files |

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Bash | 3.2+ | Orchestrator scripts |
| TypeScript | 5.x | Handlers, orchestrator TS scripts, server |
| Bun | Runtime | TypeScript execution |
| Node.js | 18+ | Express server |
| Go | 1.22+ | Attractor binary |
| tmux | — | Agent pane management |
| jq | 1.6+ | JSON processing in scripts |
| PostgreSQL | — | Relay platform database (via Drizzle ORM) |
| Linear | API | Ticket management |
| Slack | Bolt | Relay platform communication |

## Source → Runtime Deployment Model

The repository uses a two-layer model:

- **`src/`** = Canonical source of truth (git-tracked)
- **`.claude/`, `.collab/`, `.specify/`** = Runtime directories (gitignored, populated by install)

Install (`scripts/install.sh` for local, `collab.install.sh` for remote) copies from `src/` to runtime directories. This means:
- Edit in `src/`, never in runtime dirs (Constitution Principle I)
- Runtime dirs don't exist in fresh clones until install runs
- `.test.ts` files are excluded from deployment

## What to Read Next

- **How the state machine works**: `L2-orchestrator-state-machine.md`
- **How install works**: `L2-install-system.md`
- **Other subsystems (CLI, server, attractor, skills)**: `L2-subsystems.md`
- **Every script documented**: `L3-script-reference.md`
- **Find any file**: `file-index.md`
