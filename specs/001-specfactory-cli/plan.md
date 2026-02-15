# Implementation Plan: CLI Plugin for SpecFactory

**Branch**: `001-specfactory-cli` | **Date**: 2026-02-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-specfactory-cli/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

**Primary Requirement**: Enable backend developers to test SpecFactory workflow end-to-end without configuring Slack workspace, supporting local development, automated testing, and bug isolation.

**Technical Approach**: Build a thin HTTP REST client (Node.js CLI) that orchestrates the same API calls as the Slack plugin, replacing Slack Block Kit with terminal prompts (@clack/prompts). Backend requires conditional Slack initialization via PLUGIN_TYPE environment variable. All LLM operations, session management, and spec persistence remain unchanged. CLI uses os.username + epoch as session identifier, delegates API key to backend, and provides JSON output mode for test automation.

## Technical Context

**Language/Version**: Node.js v18+, TypeScript 5.x
**Primary Dependencies**:
  - @clack/prompts (terminal UI, consistent with SpecKit)
  - node-fetch (HTTP client for REST API calls)
  - commander (CLI arg parsing)
  - Existing backend: Express, Drizzle ORM, PostgreSQL

**Storage**: PostgreSQL (shared with backend) via REST API - no direct DB access from CLI
**Testing**:
  - Unit tests: Vitest (matching SpecKit patterns)
  - Contract tests: Validate CLI requests match Slack plugin API usage
  - Integration tests: CLI + backend in single-process test environment

**Target Platform**: macOS/Linux/Windows developer machines (cross-platform Node.js)
**Project Type**: Single CLI binary (not web/mobile)

**Performance Goals**:
  - Full workflow completion: <2 minutes (SC-001)
  - LLM operations: <60 seconds per call (SC-010)
  - Terminal responsiveness: <100ms for input handling

**Constraints**:
  - Must use identical REST API endpoints as Slack plugin (FR-012)
  - No LLM SDK dependencies - backend delegation only
  - Exit codes: 0 for success, non-zero for failures (FR-015)
  - JSON output mode for programmatic parsing (FR-009)

**Scale/Scope**:
  - Single developer concurrent sessions (not multi-user)
  - Feature descriptions up to 1000 words (edge case tested)
  - QA workflows up to 50 questions (backend scales, CLI orchestrates)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: No constitution file exists at `.specify/memory/constitution.md`. Constitution check skipped.

**Note**: If project principles are established in future, re-evaluate this feature against:
  - Test-first development requirements
  - Library vs CLI architecture patterns
  - Integration testing standards
  - Complexity justification thresholds

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
cli/                          # New CLI plugin directory
├── src/
│   ├── index.ts             # CLI entrypoint, commander setup
│   ├── client.ts            # HTTP client for backend API calls
│   ├── prompts.ts           # Terminal UI with @clack/prompts
│   ├── output.ts            # JSON envelope formatter
│   ├── session.ts           # Session ID generation (cli-username-epoch)
│   └── retry.ts             # Exponential backoff logic for transient errors
├── tests/
│   ├── contract/            # Validate CLI requests match Slack plugin API usage
│   ├── integration/         # CLI + backend end-to-end tests
│   └── unit/                # Pure function tests (session ID, retry, output)
├── package.json
└── tsconfig.json

src/                          # Existing backend (unchanged except conditional Slack init)
├── index.ts                 # Server entrypoint - add PLUGIN_TYPE logic
├── routes/
│   └── specfactory.ts       # Add conditional Slack operations in /channel endpoint
├── services/
│   ├── session.ts           # Already accepts pmUserId (works with CLI format)
│   ├── llm.ts               # Already reads OPENROUTER_API_KEY (no change)
│   ├── spec.ts              # No change
│   ├── role.ts              # No change
│   ├── blind-qa.ts          # No change
│   └── channel.ts           # Add skipSlack parameter for CLI mode
└── tests/                   # Existing backend tests (no change)
```

**Structure Decision**: Single project (Option 1) with new `cli/` directory for CLI plugin. Backend remains in `src/`. Both share PostgreSQL database via REST API boundary. The CLI is a separate entrypoint (`cli/src/index.ts`) but lives in the same monorepo as the backend.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
