# Drone Brief: @dashboard for BRE-447

Mind pane ID (for sending completion signal): %34174

## Tasks assigned to you

- [ ] T001 @dashboard Create `minds/dashboard/MIND.md` with full domain profile: BRE-445 architecture (aggregator → SSE → React SPA), tech stack (React + TypeScript + Tailwind CSS v3 + Lucide React), design reference (Magic Patterns `3er2jlzffejsecvcdqq4ni`), visual rules (dark theme, violet accent `#8b5cf6`, hover-only arrows, status colors), UI component inventory (TopNav, TicketHeader, StatsRow, WaveProgress, DroneGrid, ContractFlow), state model (MindsState, Wave, Drone, Contract), aggregator routes (GET /minds, /api/minds/active, /api/minds/waves, /api/minds/contracts, /subscribe/minds-status), event types consumed, anti-patterns, and review focus
- [ ] T002 @dashboard Create `minds/dashboard/server.ts` following `createMind()` pattern from `minds/server-base.ts`. Import MindsEventType and MindsBusMessage from `minds/transport/minds-events.ts` (already exist). Capabilities: `build minds state from event`, `get minds state`, `serve dashboard`. Exposes: `MindsState types`, `MindsStateBuilder`. Name: `dashboard`, domain: dashboard description, owns_files: `minds/dashboard/`, keywords: `dashboard`, `minds`, `state`, `wave`, `drone`, `contract`, `sse`, `react`, `visualization`
- [ ] T003 @dashboard Regenerate `minds.json` by running `bun minds/generate-registry.ts` — verify output contains 15 Minds (up from 14) and @dashboard entry has correct `owns_files`, `capabilities`, `exposes`, `consumes`
- [ ] T004 @dashboard Verify `bun minds/dashboard/server.ts` starts without runtime errors (import resolution, type checks)

## Reference files (read these first)

- `minds/server-base.ts` — createMind() factory
- `minds/mind.ts` — WorkUnit, WorkResult types
- `minds/observability/server.ts` — reference Mind implementation
- `minds/observability/MIND.md` — reference MIND.md format
- `minds/transport/minds-events.ts` — MindsEventType, MindsBusMessage (import from here)
- `minds/transport/status-aggregator.ts` — aggregator server (dashboard routes will be added in BRE-445, not this ticket)

## MIND.md content requirements

The MIND.md must include all of the following sections:

### Domain
Dashboard owns the Minds Live Dashboard: React SPA for visualizing Mind+Drone execution, state aggregation from bus events, and aggregator route extensions for Minds-specific data.

### Architecture
- Aggregator (existing in `minds/transport/status-aggregator.ts`) receives bus events from all pipelines
- Dashboard adds Minds-specific routes to the aggregator: `GET /minds` (SPA), `/api/minds/active`, `/api/minds/waves`, `/api/minds/contracts`, `/subscribe/minds-status` (SSE)
- React SPA built to `minds/dashboard/dist/`, served as static assets from aggregator
- State model built from `MindsEventType` events: WAVE_STARTED, WAVE_COMPLETE, DRONE_SPAWNED, DRONE_COMPLETE, DRONE_REVIEWING, DRONE_REVIEW_PASS, DRONE_REVIEW_FAIL, DRONE_MERGING, DRONE_MERGED, CONTRACT_FULFILLED

### Tech Stack
- React + TypeScript + Tailwind CSS v3 + Lucide React
- No extra bundler — Bun builds

### Design Reference
- Magic Patterns mock: editor ID `3er2jlzffejsecvcdqq4ni`
- Dark theme, violet accent (#8b5cf6)
- Hover-only dependency arrows (no spiderweb)
- Status colors: green=complete, violet=active, gray=pending, red=failed
- Straight lines with arrowheads for dependencies

### UI Components
- TopNav: ticket ID, pipeline status
- TicketHeader: ticket summary, overall progress
- StatsRow: wave count, drone count, contract count, elapsed time
- WaveProgress: columns per wave, spinner on active wave
- DroneGrid: Mind cards within each wave column showing status
- ContractFlow: hover-triggered dependency arrows between Mind cards

### State Model
- `MindsState`: top-level state container
- `Wave`: { id, status, drones[], startedAt, completedAt }
- `Drone`: { mindName, status, paneId, worktree, startedAt, completedAt }
- `Contract`: { producer, consumer, interface, status }

### Aggregator Routes
- `GET /minds` — serves the React SPA (index.html from dist/)
- `GET /api/minds/active` — JSON: current MindsState
- `GET /api/minds/waves` — JSON: wave details
- `GET /api/minds/contracts` — JSON: contract status
- `GET /subscribe/minds-status` — SSE: real-time MindsState updates

### Events Consumed
Import from `minds/transport/minds-events.ts`:
- `MindsEventType` enum
- `MindsBusMessage` interface

### Anti-Patterns
- Do NOT import transport internals (bus-server, bridges) — only the event types
- Do NOT create a separate HTTP server — routes are added to the existing aggregator
- Do NOT hardcode ticket IDs or bus URLs
- Do NOT store state in files — state is in-memory, rebuilt from events

### Review Focus
- All imports from `minds/transport/minds-events.ts`, never transport internals
- server.ts follows createMind() pattern exactly (name, domain, keywords, owns_files, capabilities, exposes, consumes, handle function)
- State types match the event types from MindsEventType
- No runtime imports of modules outside `minds/dashboard/` and `minds/transport/minds-events.ts`

## server.ts requirements

Follow the exact pattern from `minds/observability/server.ts`:
1. Import `createMind` from `../server-base.js`
2. Import `WorkUnit`, `WorkResult` from `../mind.js`
3. Import `MindsEventType`, `MindsBusMessage` from `../transport/minds-events.js`
4. Define `handle(workUnit: WorkUnit): Promise<WorkResult>` with switch on `workUnit.intent`
5. Intents: `build minds state from event`, `get minds state`, `serve dashboard`
6. For now, handle functions can return stub results — the actual implementation comes in BRE-445
7. Export default `createMind({ name, domain, keywords, owns_files, capabilities, exposes, consumes, handle })`
8. `consumes` array: `["transport/MindsEventType", "transport/MindsBusMessage"]`

## Acceptance criteria

- All tasks marked [X] in tasks.md
- `minds/dashboard/MIND.md` exists with all sections above
- `minds/dashboard/server.ts` follows createMind() pattern
- `bun minds/generate-registry.ts` outputs 15 Minds
- `bun minds/dashboard/server.ts` runs without errors
- No files modified outside `minds/dashboard/`

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside minds/dashboard/
- [ ] server.ts follows createMind() pattern exactly
- [ ] MIND.md has all required sections
- [ ] All imports use .js extension (Bun ESM convention)
- [ ] bun minds/generate-registry.ts shows 15 Minds
- [ ] bun minds/dashboard/server.ts starts without errors
- [ ] No lint errors

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, send completion signal via the bus:

```bash
bun minds/transport/minds-publish.ts --channel minds-BRE-447 --type DRONE_COMPLETE --payload '{"mindName":"dashboard"}'
```

The bus URL is resolved automatically from `BUS_URL` env var or `.collab/bus-port`.
