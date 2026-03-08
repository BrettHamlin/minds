# Drone Brief: @dashboard for BRE-445

Mind pane ID (for sending completion signal): %34174

## Tasks assigned to you

- [ ] T001 @dashboard Create `MindsStateTracker` class in `minds/dashboard/state-tracker.ts`. Maintains `Map<ticketId, MindsState>` in memory. Methods: `applyEvent(msg)` processes each event type and updates state, `getState(ticketId)` returns state for one ticket, `getAllActive()` returns all tracked tickets, `subscribe(cb)` registers callback for SSE fan-out (returns unsubscribe fn). Extend existing `MindsState` type with `ticketTitle`, `startedAt`, `stats` fields per ticket spec. Add `tasks` and `reviewAttempts` fields to `Drone` type. Import event types already available in the codebase — produces: MindsStateTracker at minds/dashboard/state-tracker.ts
- [ ] T002 @dashboard Create unit tests in `minds/dashboard/state-tracker.test.ts`. Cover: WAVE_STARTED creates wave entry, DRONE_SPAWNED adds drone to correct wave, DRONE_COMPLETE marks drone complete, reviewing and review pass and review fail status transitions, merging and merged status transitions, CONTRACT_FULFILLED updates contract status, WAVE_COMPLETE marks wave complete, subscribe callback fires on event, getState returns undefined for unknown ticket, getAllActive returns all tracked tickets
- [ ] T003 @dashboard Create `createMindsRouteHandler()` in `minds/dashboard/route-handler.ts`. Accepts `MindsStateTracker` instance. Returns a function `(req: Request) => Response | null` where null means not handled (caller falls through). Handles routes for: serving the React SPA HTML and static assets from `minds/dashboard/dist/`, returning JSON for active minds state and wave and contract queries, creating an SSE stream using tracker.subscribe() for real-time updates — produces: createMindsRouteHandler() at minds/dashboard/route-handler.ts
- [ ] T004 @dashboard Create unit tests in `minds/dashboard/route-handler.test.ts`. Cover: active state endpoint returns JSON array, wave query endpoint returns waves for a ticket, contract query endpoint returns contracts for a ticket, SPA route serves HTML content type, SSE endpoint returns event-stream content type, unknown route returns null
- [ ] T005 @dashboard Create React build configuration: `minds/dashboard/package.json` (react, react-dom, lucide-react, tailwindcss v3 as deps), `minds/dashboard/tsconfig.json` (jsx react-jsx, strict, target ES2022), `minds/dashboard/tailwind.config.js` (content glob for tsx files, dark theme colors from mock), `minds/dashboard/src/index.html` (minimal HTML shell with root div), `minds/dashboard/src/index.css` (Tailwind base, components, utilities imports plus CSS custom properties for dark theme: background 224 71% 4%, card 222 47% 11%, etc.), `minds/dashboard/src/index.tsx` (React root render), `minds/dashboard/build.ts` (Bun.build entrypoint to dist, copies index.html)
- [ ] T006 @dashboard Create `minds/dashboard/src/App.tsx` and `minds/dashboard/src/components/layout/TopNav.tsx`. App renders TopNav plus LiveView. TopNav has Minds branding with BrainIcon, Live tab active, connection status indicator dot. For this ticket only the Live tab is functional — History and Plan render placeholder text. Match mock: dark bg, violet accent, border-bottom
- [ ] T007 @dashboard Create `minds/dashboard/src/components/live/LiveView.tsx` (orchestrates ticket header, stats, waves, drones, contracts), `minds/dashboard/src/components/live/RunSwitcher.tsx` (ticket selector dropdown for picking active ticket from state), `minds/dashboard/src/components/live/StatsRow.tsx` (5 stat cards: Minds Involved, Active Drones, Current Wave progress, Elapsed time, Contracts progress — each with Lucide icon, match mock colors)
- [ ] T008 @dashboard Create `minds/dashboard/src/components/live/WaveTimeline.tsx`. Waves as columns. Mind pills stacked vertically per wave. Colored status dots: green for complete, violet for active, zinc for pending, red for failed. Status labels right-aligned on pill. Spinner plus "in progress" above active wave. Checkmark plus "complete" above done waves. Dependency count badges as small circles top-right of each pill. Match mock layout exactly
- [ ] T009 @dashboard Create `minds/dashboard/src/components/live/DroneGrid.tsx` (per-drone cards with mind name, status badge, progress bar for task completion, elapsed time, worktree path, review attempt count, merge status) and `minds/dashboard/src/components/live/ContractFlow.tsx` (on Mind pill hover: show dependency arrows as straight lines from producer right edge to consumer left edge with arrowhead, green solid for fulfilled and violet dashed for pending, unrelated Minds dim to 30% opacity, tooltip with contract name and direction)
- [ ] T010 @dashboard Create `minds/dashboard/src/hooks/useMindsState.ts` (custom React hook using EventSource for SSE connection, parses SSE data into MindsState, reconnects on disconnect, returns states array plus activeTicket plus setActiveTicket plus connected boolean) and `minds/dashboard/src/data/mockData.ts` (realistic mock MindsState for development — 3 waves, 5 minds, 8 contracts, mix of statuses). Wire hook into LiveView using mock data as fallback when SSE is not connected
- [ ] T011 @dashboard Update `minds/dashboard/server.ts` — replace stub handlers with real implementations: `build minds state from event` intent calls `MindsStateTracker.applyEvent()`, `get minds state` intent calls `tracker.getState()` or `tracker.getAllActive()`, `serve dashboard` intent returns route handler reference. Export tracker instance for aggregator integration
- [ ] T012 @dashboard Build the React SPA by running `bun minds/dashboard/build.ts` and verify `minds/dashboard/dist/` contains index.html, bundled JS, and CSS output. Verify the build completes without errors

## Reference files (read these first)

- `minds/dashboard/MIND.md` — full domain profile with architecture, design reference, UI components, state model, anti-patterns, review focus
- `minds/dashboard/server.ts` — existing stub Mind server (BRE-447), has state type definitions (MindsState, Wave, Drone, Contract) to extend
- `minds/server-base.ts` — createMind() factory
- `minds/mind.ts` — WorkUnit, WorkResult types
- `minds/transport/minds-events.ts` — MindsEventType enum, MindsBusMessage interface (import from here)
- `minds/transport/status-aggregator.ts` — existing aggregator (dashboard routes added to this in BRE-445 by @transport, not by you)

## Design reference (CRITICAL — match this exactly)

The Magic Patterns mock is the source of truth for visual design. Key specs from the mock:

### Colors (CSS custom properties)
- `--background: 224 71% 4%` (near-black)
- `--card: 222 47% 11%` (dark card bg)
- `--foreground: 210 40% 98%` (light text)
- `--border: 217 33% 17%` (subtle borders)
- Violet accent: `#8b5cf6` / `violet-500`
- Status: green-500 = complete, violet-500 = active, zinc-500 = pending, red-500 = failed, amber-500 = reviewing, blue-500 = merging

### Layout
- TopNav: h-16, bg-zinc-950, border-b, BrainIcon + "Minds" text, tab buttons, connection dot
- StatsRow: 5 cards in a flex row, each with icon + label + value, bg-card rounded-xl border p-4
- WaveTimeline: horizontal flex of wave columns, each column contains vertically stacked Mind pills
- Mind pills: rounded-lg bg-card border, colored dot left + name + status label right, ~40px height
- DroneGrid: grid of cards below the wave timeline
- ContractFlow: SVG overlay for dependency arrows (only visible on hover)

### Interactions
- Hover Mind pill: show dependency arrows, dim unrelated pills to 30% opacity
- Arrows: straight lines, green solid = fulfilled, violet dashed = pending
- Dependency count badges: small circles top-right of pill, visible when NOT hovering

## State types to extend

The existing types in `minds/dashboard/server.ts` need extending:

```typescript
// Extend MindsState with:
export interface MindsState {
  ticketId: string;
  ticketTitle: string;  // NEW
  startedAt: string;    // NEW
  waves: Wave[];
  contracts: Contract[];
  updatedAt: string;
  stats: {              // NEW
    mindsInvolved: number;
    activeDrones: number;
    currentWave: number;
    totalWaves: number;
    contractsFulfilled: number;
    contractsTotal: number;
  };
}

// Extend Drone with:
export interface Drone {
  mindName: string;
  status: "pending" | "active" | "reviewing" | "merging" | "complete" | "failed";
  paneId?: string;
  worktree?: string;
  startedAt?: string;
  completedAt?: string;
  tasks?: number;         // NEW — total task count
  tasksComplete?: number; // NEW — completed task count
  reviewAttempts?: number; // NEW
  violations?: number;     // NEW
  branch?: string;         // NEW
}
```

## Interface contracts

- Produces: `MindsStateTracker` at `minds/dashboard/state-tracker.ts`, `createMindsRouteHandler()` at `minds/dashboard/route-handler.ts`
- Consumes: `MindsEventType` and `MindsBusMessage` from `minds/transport/minds-events.ts` (already exist, import them)

## Acceptance criteria

- All tasks marked [X] in tasks.md
- All produced interfaces exported at their declared paths
- `bun test` passes with no failures (run from `minds/dashboard/` scope)
- No files modified outside `minds/dashboard/`
- React SPA builds successfully via `bun minds/dashboard/build.ts`
- State tracker correctly processes all 10 MindsEventType values
- Route handler returns proper responses for all 5 route patterns

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside minds/dashboard/
- [ ] No duplicated logic (check against existing codebase)
- [ ] All new exported functions have tests
- [ ] All tests pass (`bun test`)
- [ ] No lint errors
- [ ] Interface contracts honored (produces/consumes match declarations)
- [ ] No hardcoded values that should be config
- [ ] Error messages include context (not just "failed")
- [ ] All imports from transport use `minds/transport/minds-events.ts` only (never transport internals)
- [ ] State types match MindsEventType events
- [ ] `import type` used for type-only imports
- [ ] React SPA builds without errors
- [ ] CSS custom properties match the mock color values exactly

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, send completion signal via the bus:

```bash
bun minds/transport/minds-publish.ts --channel minds-BRE-445 --type DRONE_COMPLETE --payload '{"mindName":"dashboard"}'
```

The bus URL is resolved automatically from `BUS_URL` env var or `.collab/bus-port`.
