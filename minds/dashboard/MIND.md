# @dashboard Mind Profile

## Domain

Dashboard owns the Minds Live Dashboard: React SPA for visualizing Mind+Drone execution, state aggregation from bus events, and aggregator route extensions for Minds-specific data.

## Architecture

- Aggregator (existing in `minds/transport/status-aggregator.ts`) receives bus events from all pipelines
- Dashboard adds Minds-specific routes to the aggregator: `GET /minds` (SPA), `/api/minds/active`, `/api/minds/waves`, `/api/minds/contracts`, `/subscribe/minds-status` (SSE)
- React SPA built to `minds/dashboard/dist/`, served as static assets from aggregator
- State model built from `MindsEventType` events: WAVE_STARTED, WAVE_COMPLETE, DRONE_SPAWNED, DRONE_COMPLETE, DRONE_REVIEWING, DRONE_REVIEW_PASS, DRONE_REVIEW_FAIL, DRONE_MERGING, DRONE_MERGED, CONTRACT_FULFILLED

## Tech Stack

- React + TypeScript + Tailwind CSS v3 + Lucide React
- No extra bundler — Bun builds

## Design Reference

- Magic Patterns mock: editor ID `3er2jlzffejsecvcdqq4ni`
- Dark theme, violet accent (`#8b5cf6`)
- Hover-only dependency arrows (no spiderweb)
- Status colors: green=complete, violet=active, gray=pending, red=failed
- Straight lines with arrowheads for dependencies

## UI Components

- **TopNav**: ticket ID, pipeline status
- **TicketHeader**: ticket summary, overall progress
- **StatsRow**: wave count, drone count, contract count, elapsed time
- **WaveProgress**: columns per wave, spinner on active wave
- **DroneGrid**: Mind cards within each wave column showing status
- **ContractFlow**: hover-triggered dependency arrows between Mind cards

## State Model

- `MindsState`: top-level state container
- `Wave`: `{ id, status, drones[], startedAt, completedAt }`
- `Drone`: `{ mindName, status, paneId, worktree, startedAt, completedAt }`
- `Contract`: `{ producer, consumer, interface, status }`

## Aggregator Routes

- `GET /minds` — serves the React SPA (index.html from dist/)
- `GET /api/minds/active` — JSON: current MindsState
- `GET /api/minds/waves` — JSON: wave details
- `GET /api/minds/contracts` — JSON: contract status
- `GET /subscribe/minds-status` — SSE: real-time MindsState updates

## Events Consumed

Import from `minds/transport/minds-events.ts`:
- `MindsEventType` enum
- `MindsBusMessage` interface

Events consumed by state builder:
- `WAVE_STARTED` — initialize a new Wave entry
- `WAVE_COMPLETE` — mark wave as complete
- `DRONE_SPAWNED` — add Drone to wave
- `DRONE_COMPLETE` — mark drone as complete
- `DRONE_REVIEWING` — mark drone as reviewing
- `DRONE_REVIEW_PASS` — mark drone review as passed
- `DRONE_REVIEW_FAIL` — mark drone review as failed
- `DRONE_MERGING` — mark drone as merging
- `DRONE_MERGED` — mark drone as merged
- `CONTRACT_FULFILLED` — mark contract as fulfilled

## Anti-Patterns

- Do NOT import transport internals (bus-server, bridges) — only the event types
- Do NOT create a separate HTTP server — routes are added to the existing aggregator
- Do NOT hardcode ticket IDs or bus URLs
- Do NOT store state in files — state is in-memory, rebuilt from events

## Review Focus

- All imports from `minds/transport/minds-events.ts`, never transport internals
- `server.ts` follows `createMind()` pattern exactly (name, domain, keywords, owns_files, capabilities, exposes, consumes, handle function)
- State types match the event types from `MindsEventType`
- No runtime imports of modules outside `minds/dashboard/` and `minds/transport/minds-events.ts`
