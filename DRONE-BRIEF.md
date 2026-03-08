# Drone Brief: @transport for BRE-445

Mind pane ID (for sending completion signal): %34174

## Tasks assigned to you

- [ ] T013 @transport Import and mount dashboard route handler in `minds/transport/status-aggregator.ts`. In the `createAggregatorServer` fetch handler, call the dashboard handler before the 404 fallback. Instantiate `MindsStateTracker` in the aggregator and pass it to the route handler factory — consumes: createMindsRouteHandler() from minds/dashboard/route-handler.ts, consumes: MindsStateTracker from minds/dashboard/state-tracker.ts
- [ ] T014 @transport In `StatusAggregator._sseLoop()`, detect incoming events whose channel matches the `minds-` prefix (check event type field or parse data JSON for channel). When a minds event is received, call `tracker.applyEvent()` with the parsed message. This feeds real-time bus events into the dashboard state tracker
- [ ] T015 @transport Add integration tests in `minds/transport/__tests__/aggregator-dashboard.test.ts`: verify dashboard routes are mounted (SPA route returns 200, active state route returns JSON array), verify minds events from SSE loop are fed to state tracker, verify minds-status SSE stream emits state updates when events arrive

## Reference files (read these first)

- `minds/transport/status-aggregator.ts` — existing aggregator, modify this file
- `minds/transport/MIND.md` — transport Mind profile
- `minds/dashboard/state-tracker.ts` — MindsStateTracker class (import from here)
- `minds/dashboard/route-handler.ts` — createMindsRouteHandler() (import from here)
- `minds/transport/minds-events.ts` — MindsEventType, MindsBusMessage types

## How to integrate

### T013 — Mount routes in aggregator

In `createAggregatorServer()`:

1. Import at top of file:
   ```typescript
   import { MindsStateTracker } from "../dashboard/state-tracker.js";
   import { createMindsRouteHandler } from "../dashboard/route-handler.js";
   ```

2. Inside `createAggregatorServer`, before `Bun.serve`:
   ```typescript
   const mindsTracker = new MindsStateTracker();
   const mindsHandler = createMindsRouteHandler(mindsTracker);
   ```

3. In the `fetch` handler, BEFORE the 404 fallback, add:
   ```typescript
   const mindsResponse = mindsHandler(req);
   if (mindsResponse) return mindsResponse;
   ```

4. Make `mindsTracker` accessible to the aggregator (store it on the aggregator instance or return it from the factory).

### T014 — Feed minds events to tracker

In `StatusAggregator._sseLoop()`, inside the frame processing loop where `dataLine` is available:

1. Parse the data JSON
2. Check if the parsed message has a `channel` field matching `minds-` prefix
3. If so, cast to `MindsBusMessage` and call `mindsTracker.applyEvent(parsedMsg)`
4. The tracker's `subscribe()` callbacks will automatically notify SSE clients

### T015 — Integration tests

Create `minds/transport/__tests__/aggregator-dashboard.test.ts`:
- Start a test aggregator via `createAggregatorServer({ port: 0, registryDir: tmpDir })`
- Verify `GET /minds` returns 200 with HTML content type
- Verify `GET /api/minds/active` returns JSON array (empty initially)
- Feed a mock MindsBusMessage to the tracker, verify `/api/minds/active` now returns data
- Verify `GET /subscribe/minds-status` returns event-stream content type

## Interface contracts

- Consumes: `MindsStateTracker` from `minds/dashboard/state-tracker.ts` (already merged — import it)
- Consumes: `createMindsRouteHandler()` from `minds/dashboard/route-handler.ts` (already merged — import it)
- Do NOT reimplement these — import from the declared paths

## Acceptance criteria

- All tasks marked [X]
- Dashboard routes respond correctly when aggregator is running
- Minds events from bus SSE are fed to the state tracker
- All tests pass (`bun test minds/transport/`)
- No files modified outside `minds/transport/`

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside minds/transport/
- [ ] No duplicated logic — imports MindsStateTracker and createMindsRouteHandler, does not reimplement
- [ ] All new functions have tests
- [ ] All tests pass (`bun test minds/transport/`)
- [ ] No lint errors
- [ ] Interface contracts honored
- [ ] No hardcoded values
- [ ] Error messages include context
- [ ] `import type` used for type-only imports where applicable

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, send completion signal via the bus:

```bash
bun minds/transport/minds-publish.ts --channel minds-BRE-445 --type DRONE_COMPLETE --payload '{"mindName":"transport"}'
```

The bus URL is resolved automatically from `BUS_URL` env var or `.collab/bus-port`.
