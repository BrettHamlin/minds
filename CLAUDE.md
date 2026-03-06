# 001-specfactory-cli Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-02-14

## Active Technologies
- Go 1.22+ + Standard library only (`regexp`, `os/exec`, `sync`, `encoding/json`, `flag`, `bufio`, `os`, `context`, `fmt`) — zero external Go modules (001-attractor-ai-gates)
- JSON files at `.collab/state/pipeline-registry/{TICKET_ID}.json` (read-only for most fields; atomic write for `analysis_remediation_done` and `retry_count`); `.collab/config/verify-config.json`, `.collab/config/pipeline.json`, `.collab/config/verify-patterns.json` read at handler ini (001-attractor-ai-gates)
- Bash (bash 3.2+ compatible), JSON + `jq` 1.6+ (already required by existing scripts), `git` (for repo root detection) (001-pipeline-json)
- `.collab/config/pipeline.json` (config file read at script invocation time) (001-pipeline-json)
- Bash 3.2+ (orchestrator scripts), TypeScript/Bun (handlers and token resolution), JSON (config and schema) + `jq` 1.6+, `bun` (runtime for TypeScript), `ajv-cli` (new dev dep via `bun add -d ajv ajv-cli`), `tmux` (existing) (001-pipeline-v3-schema)
- `.collab/state/pipeline-registry/{TICKET_ID}.json` (registry, extended with `phase_history`, `held_at`, `waiting_for`), `.collab/config/pipeline.json` (v3 config) (001-pipeline-v3-schema)

- Node.js v18+, TypeScript 5.x (001-specfactory-cli)

## Project Structure

```text
backend/
frontend/
tests/
```

## Commands

npm test && npm run lint

## Code Style

Node.js v18+, TypeScript 5.x: Follow standard conventions

## Recent Changes
- 001-pipeline-v3-schema: Added Bash 3.2+ (orchestrator scripts), TypeScript/Bun (handlers and token resolution), JSON (config and schema) + `jq` 1.6+, `bun` (runtime for TypeScript), `ajv-cli` (new dev dep via `bun add -d ajv ajv-cli`), `tmux` (existing)
- 001-pipeline-json: Added Bash (bash 3.2+ compatible), JSON + `jq` 1.6+ (already required by existing scripts), `git` (for repo root detection)
- 001-attractor-ai-gates: Added Go 1.22+ + Standard library only (`regexp`, `os/exec`, `sync`, `encoding/json`, `flag`, `bufio`, `os`, `context`, `fmt`) — zero external Go modules


<!-- MANUAL ADDITIONS START -->

## CORE ENGINEERING PRINCIPLES (MANDATORY)

### Deterministic Code vs LLM Responsibilities

**Lean heavily on deterministic code.** Deterministic code is testable, produces precise repeatable outcomes, and is the foundation of a production-ready system.

**Deterministic code (TypeScript/Bun) handles:**
- Signal names, phase transitions, validation, routing
- Schema construction and validation (e.g., FindingsBatch format)
- File path construction (registry, findings, resolutions)
- Pipeline config reading and interpretation
- Gate prompt resolution and verdict validation
- Retry counts, execution mode detection, dependency holds
- Any value that MUST be correct for the pipeline to function

**LLM (Markdown) handles ONLY:**
- Code reviews, analysis, creative decisions — anything requiring judgment
- Deciding pass/fail verdicts (the judgment call, not the format)
- Writing spec content, plan content, implementation code
- Answering clarification questions

**When in doubt, make it deterministic.** If something CAN be code, it SHOULD be code.

### Language: TypeScript + Bun

All new code MUST be written in TypeScript and run with Bun. No exceptions. No shell scripts for new features.

### DRY — No Code Duplication

- Single source of truth for every piece of logic
- Reuse existing utilities (`loadPipelineForTicket`, `validateTicketIdArg`, `resolveSignalName`, etc.)
- Before creating a new utility, check if one already exists
- Export shared constants and functions, don't duplicate them

### All Tests Must Pass — No Exceptions

If ANY test fails — whether from current changes or pre-existing — it MUST be fixed. "Pre-existing failure" is NEVER an acceptable excuse. This is a production-ready system. The standard is: everything passes, everything works, no excuses.

Run `bun test` before every commit. All tests must pass.

## COLLAB PIPELINE — ALGORITHM DEPTH RULES (MANDATORY OVERRIDE)

**These rules override PAI FormatReminder hook depth classification for this project.**

The following message patterns are ALWAYS complex orchestration tasks requiring **FULL depth** PAI Algorithm processing (all 7 phases). They are NEVER social, NEVER simple acknowledgments, and NEVER MINIMAL depth — regardless of message length:

- **`[SIGNAL:...]`** — Pipeline orchestration events. A single-line signal triggers: validate → get pane → route (6 sub-steps) → gate evaluation (reads files, evaluates against ticket AC) → phase advance (4 scripts) → notify. Complex by definition.
- **`[CMD:...]`** — Pipeline command processing.
- **`/collab.*`** — Collab phase commands (clarify, plan, tasks, analyze, implement, blindqa, run).

**If the FormatReminder hook classifies any of the above as MINIMAL:** that classification is incorrect for this project. Ignore it and use FULL depth. The skill instructions in `collab.run.md` define the required work — execute them fully.

**Why this matters:** MINIMAL depth skips orchestrator gate evaluation, feedback relay, and phase dispatch. This causes agents to receive no instructions and pipelines to stall silently.

<!-- MANUAL ADDITIONS END -->
