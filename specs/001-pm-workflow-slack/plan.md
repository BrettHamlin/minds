# Implementation Plan: PM Workflow in Slack (MVP Core)

**Branch**: `001-pm-workflow-slack` | **Date**: 2026-02-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-pm-workflow-slack/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Build an MVP Slack bot that enables Product Managers to create feature specifications through an interactive workflow. The PM invokes `/specfactory`, provides a feature description, selects team members, and then participates in an AI-driven Blind QA questioning session within a dedicated Slack coordination channel. The system generates a formatted specification document accessible via web link at `https://specfactory.app/spec/{ID}`. This eliminates manual spec creation overhead and ensures comprehensive requirements gathering through structured questioning.

## Technical Context

**Language/Version**: TypeScript with Node.js (Express backend per FR-020)
**Primary Dependencies**: Express, @slack/bolt (Slack SDK), NEEDS CLARIFICATION (LLM provider: OpenAI/Anthropic/Google), NEEDS CLARIFICATION (Database ORM/client)
**Storage**: NEEDS CLARIFICATION (Database technology: PostgreSQL/MongoDB/SQLite/Redis - see research.md)
**Testing**: NEEDS CLARIFICATION (Testing framework not specified in spec - recommend Jest for TypeScript)
**Target Platform**: Linux/macOS server (backend), Web browser (for spec viewing at specfactory.app)
**Project Type**: Web application (backend API + static web frontend)
**Performance Goals**: <3 seconds spec page load time (SC-007), <30 minutes full workflow completion (SC-001), 5-20 questions per spec based on complexity (SC-004)
**Constraints**: HTTPS required for web endpoint, Slack OAuth permissions (channels:manage, channels:write, chat:write, commands, users:read), Domain specfactory.app required
**Scale/Scope**: MVP single-PM workflow, concurrent session support (SC-009), no multi-tenant requirements, English-only (per assumptions)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: No constitution file found at `.specify/memory/constitution.md`. Proceeding with general best practices gates:

| Gate | Status | Notes |
|------|--------|-------|
| Test-First Development | ⚠️ NEEDS PLAN | No tests specified in spec; must define testing strategy in Phase 1 |
| Clear Module Boundaries | ✅ PASS | Clean separation: Slack bot, LLM integration, database, web server |
| Single Responsibility | ✅ PASS | Each component has focused purpose |
| No Premature Abstraction | ✅ PASS | MVP scope appropriate, no over-engineering in spec |
| Security by Design | ⚠️ NEEDS PLAN | Public spec links noted; need input validation, rate limiting, error handling design |
| Observability | ❌ FAIL | No logging, metrics, or tracing specified (see Complexity Tracking) |

**Pre-Phase 0 Assessment**: 2 warnings, 1 failure. Observability failure justified in Complexity Tracking as MVP scope trade-off.

**Post-Phase 1 Re-evaluation**:

| Gate | Status | Notes |
|------|--------|-------|
| Test-First Development | ✅ PASS | Vitest framework selected in research.md; test structure defined in quickstart.md |
| Clear Module Boundaries | ✅ PASS | 7-table data model with clear entity separation; API contracts define clean boundaries |
| Single Responsibility | ✅ PASS | Each table has single concern; endpoints map 1:1 to functional requirements |
| No Premature Abstraction | ✅ PASS | Drizzle ORM chosen over heavier ORMs; direct approach without unnecessary layers |
| Security by Design | ✅ PASS | OpenAPI contracts include auth requirements; data model has FK constraints for integrity |
| Observability | ❌ FAIL | Still deferred to post-MVP (justified in Complexity Tracking) |

**Assessment**: 5 passes, 1 justified failure. Ready to proceed to task generation.

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
backend/
├── src/
│   ├── db/
│   │   ├── schema.ts           # Drizzle ORM schema (from data-model.md)
│   │   ├── client.ts           # Database connection
│   │   └── migrations/         # Drizzle migrations
│   ├── slack/
│   │   ├── commands.ts         # /specfactory command handler
│   │   ├── interactions.ts     # Block Kit interactive components
│   │   └── client.ts           # Slack SDK initialization
│   ├── llm/
│   │   ├── openrouter.ts       # OpenRouter client (Claude Sonnet 4.5)
│   │   └── blind-qa.ts         # Question generation logic
│   ├── api/
│   │   ├── specfactory.ts      # API route handlers (from contracts/)
│   │   └── middleware.ts       # Auth, validation, error handling
│   ├── services/
│   │   ├── spec-service.ts     # Spec creation/retrieval business logic
│   │   ├── question-service.ts # Question generation/answering logic
│   │   └── channel-service.ts  # Slack channel management
│   └── server.ts               # Express app setup
└── tests/
    ├── contract/               # API contract tests (OpenAPI validation)
    ├── integration/            # Slack/LLM/DB integration tests
    └── unit/                   # Service/utility unit tests

frontend/
├── src/
│   ├── pages/
│   │   └── spec/[id].tsx       # Spec viewing page (SSR/SSG)
│   ├── components/
│   │   ├── spec-renderer.tsx   # Markdown/HTML spec display
│   │   └── layout.tsx          # Page layout
│   └── styles/
│       └── spec.css            # Spec page styling
└── public/
    └── assets/                 # Static assets
```

**Structure Decision**: Web application structure selected. Backend implements Express API + Slack bot with PostgreSQL persistence. Frontend is static web app for spec viewing at specfactory.app. Clear separation of concerns: DB layer (Drizzle schema), Slack integration (commands/interactions), LLM integration (OpenRouter), API layer (contracts), business logic (services).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| No Observability | MVP scope trade-off to minimize initial development time | Comprehensive logging/metrics infrastructure would delay first release; Can be added incrementally after MVP validation; MVP testing can use manual observation and basic console logs |
