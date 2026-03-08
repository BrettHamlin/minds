# Drone Brief: @transport for BRE-444

Mind pane ID (for sending completion signal): %13777

## Context

BRE-444: Migrate Minds drone/orchestrator communication from tmux-direct to bus transport.
The bus server, bridges, and BusTransport.ts are UNCHANGED. You are creating new Minds-specific
transport utilities in `minds/transport/`.

Channel convention: `minds-{ticketId}` (separate from collab's `pipeline-{ticketId}`).

## Tasks assigned to you

- [ ] T001 @transport [P] Define Minds event type constants and MindsBusMessage interface in `minds/transport/minds-events.ts`
  - Export `MindsEventType` enum with values: WAVE_STARTED, WAVE_COMPLETE, DRONE_SPAWNED, DRONE_COMPLETE, DRONE_REVIEWING, DRONE_REVIEW_PASS, DRONE_REVIEW_FAIL, DRONE_MERGING, DRONE_MERGED, CONTRACT_FULFILLED
  - Export `MindsBusMessage` interface with: channel, from, type (MindsEventType), payload, ticketId, mindName

- [ ] T002 @transport Create `minds/transport/minds-publish.ts` CLI script
  - Accepts: `--channel <minds-{ticketId}>`, `--type <event>`, `--payload <json>`
  - Publishes via `POST /publish` to bus server
  - Reads BUS_URL from env var or from `.collab/bus-port` file
  - Also export a `mindsPublish(busUrl, channel, type, payload)` function for programmatic use
  - This replaces `minds/lib/tmux-send.ts` for Minds communication

- [ ] T003 @transport [P] Create `minds/transport/minds-bus-lifecycle.ts`
  - Export `startMindsBus(repoRoot, orchestratorPane, ticketId)` — starts bus server + signal bridge using BusTransport.start(). Channel: `minds-{ticketId}`. Returns `{ busUrl, busServerPid, bridgePid }`
  - Export `teardownMindsBus(pids)` — kills bus server + bridges
  - Reuse existing BusTransport class from `./BusTransport.ts`

- [ ] T004 @transport Add tests
  - `minds/transport/__tests__/minds-publish.test.ts` — test CLI arg parsing, POST body construction, BUS_URL resolution
  - `minds/transport/__tests__/minds-bus-lifecycle.test.ts` — test lifecycle start/teardown

## Reference files (read these first)

- `minds/transport/Transport.ts` — Transport interface (publish/subscribe/teardown)
- `minds/transport/BusTransport.ts` — Existing BusTransport (reuse for lifecycle, DO NOT modify)
- `minds/transport/bus-server.ts` — Bus server (DO NOT modify, just know the POST /publish endpoint)
- `minds/transport/index.ts` — Transport resolution
- `minds/transport/resolve-transport.ts` — Path resolver

## Acceptance criteria

- All tasks marked [X]
- All produced interfaces exported at their declared paths
- `bun test` passes with no failures
- No files modified outside `minds/transport/`

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside owns_files (minds/transport/)
- [ ] No duplicated logic (check against existing codebase)
- [ ] All new functions have tests
- [ ] All tests pass (`bun test`)
- [ ] No lint errors
- [ ] Interface contracts honored (produces/consumes match declarations)
- [ ] No hardcoded values that should be config
- [ ] Error messages include context (not just "failed")

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, send completion signal to the Mind:

```bash
bun minds/lib/tmux-send.ts %13777 "DRONE_COMPLETE @transport BRE-444"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
