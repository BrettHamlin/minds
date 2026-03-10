# BRE-482 Tasks — Real-Time Event Stream Endpoint

> Linear: [BRE-482](https://linear.app/bretthamlin/issue/BRE-482/add-real-time-event-stream-endpoint-to-dashboard-web-ui)
>
> **Already implemented:** `serializeEventForSSE()` in `minds/transport/minds-events.ts` (lines 75-91) and full test suite in `minds/transport/__tests__/minds-events.test.ts` (11 tests). No @transport tasks remain.

## @dashboard Tasks (depends on: @transport — already complete)

- [x] T001 @dashboard Add `subscribeRaw(callback: (event: MindsBusMessage) => void): () => void` method to `MindsStateTracker` in minds/dashboard/state-tracker.ts. This subscribes to raw bus events BEFORE state processing (unlike the existing `subscribe()` which emits processed MindsState snapshots). Store raw subscribers in a separate `rawSubscribers: Set<(event: MindsBusMessage) => void>`. Call all raw subscribers at the top of `applyEvent()` before any state mutation. Return an unsubscribe function that removes the callback from the set. — produces: `subscribeRaw()` at minds/dashboard/state-tracker.ts
- [x] T002 @dashboard Add `/api/minds/events` SSE endpoint in minds/dashboard/route-handler.ts. The endpoint: (1) requires `?ticket=` query param (return 400 if missing), (2) creates a ReadableStream, (3) uses `tracker.subscribeRaw()` to receive raw `MindsBusMessage` events, (4) filters events by `ticketId` matching the query param, (5) formats each event using `serializeEventForSSE()` from `@minds/transport/minds-events.js`, (6) cleans up the raw subscription on client disconnect via the stream's `cancel()` handler. Return SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`. — consumes: `subscribeRaw()` from minds/dashboard/state-tracker.ts, `serializeEventForSSE()` from minds/transport/minds-events.ts
- [ ] T003 @dashboard Add unit tests for `subscribeRaw()` in minds/dashboard/state-tracker.test.ts — test: (1) raw callback fires for each event with the original MindsBusMessage, (2) unsubscribe stops delivery, (3) multiple raw subscribers work independently, (4) raw subscription does not interfere with state subscription (both fire), (5) raw callback receives event before state is mutated (verify by checking state inside callback)
- [ ] T004 @dashboard Add unit tests for `/api/minds/events` endpoint in minds/dashboard/route-handler.test.ts — test: (1) returns `text/event-stream` Content-Type, (2) returns `no-cache` Cache-Control, (3) returns 400 when `?ticket=` param is missing, (4) unknown route still returns null (regression)

## Cross-Mind Contracts

| Producer | Interface | Consumer |
|----------|-----------|----------|
| @transport | `serializeEventForSSE()` at minds/transport/minds-events.ts | @dashboard (route-handler.ts) |
| @transport | `MindsBusMessage` type at minds/transport/minds-events.ts | @dashboard (state-tracker.ts, route-handler.ts) |
| @dashboard | `subscribeRaw()` at minds/dashboard/state-tracker.ts | @dashboard (route-handler.ts) |

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 4 |
| @transport | 0 (already complete) |
| @dashboard | 4 |
| Cross-Mind contracts | 3 (1 new: subscribeRaw, 2 existing from transport) |
| Parallel opportunities | T001 can start immediately; T003 can start as soon as T001 is done; T002 depends on T001; T004 depends on T002 |
| Dependency order | T001 → T002 (sequential, T002 consumes subscribeRaw); T001 → T003 (test the new method); T002 → T004 (test the new endpoint) |

## Notes

- The ticket's `formatEventForSSE` is already implemented as `serializeEventForSSE` in transport — same function, name follows existing codebase convention.
- Dashboard already imports from `@minds/transport/minds-events.js` (see state-tracker.ts line 6) — the new endpoint follows the same import path.
- Existing `/subscribe/minds-status` streams processed MindsState snapshots; new `/api/minds/events` streams raw MindsBusMessage events — different use cases, no overlap.
- Only one Mind (@dashboard) has remaining work, so all tasks are sequential within that Mind.
