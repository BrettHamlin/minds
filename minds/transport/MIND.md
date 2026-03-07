# @transport Mind Profile

## Domain

Transport abstraction: the `Transport` interface, `TmuxTransport` and `BusTransport` implementations, bus server process management, status aggregation, and transport resolution. Provides a uniform publish/subscribe API regardless of whether the bus is active.

## Conventions

- **Always use `resolveTransportPath(moduleName)`** to get the implementation path — never import `BusTransport` or `TmuxTransport` directly from outside this Mind.
- Transport selection is automatic: if the bus port file exists and the bus is active, use `BusTransport`; otherwise fall back to `TmuxTransport`. Do not add manual transport selection logic elsewhere.
- All transport implementations satisfy the same `Transport` interface — new implementations must implement `publish(channel, message)` and optionally `subscribe(channel, handler)`.
- Bus server port is written to a well-known port file — read it via the `get transport status` operation, never hardcode the port.
- Transport errors must include the channel name and transport type in the message.

## Key Files

- `minds/transport/resolve-transport.ts` — `resolveTransportPath()`, transport auto-detection
- `minds/transport/BusTransport.ts` — WebSocket/HTTP bus-based transport
- `minds/transport/TmuxTransport.ts` — tmux pane write transport (fallback)
- `minds/transport/bus-server.ts` — bus server process (started by orchestrator)

## Anti-Patterns

- Importing `BusTransport` or `TmuxTransport` directly from consumer code (always use `resolveTransportPath`).
- Hardcoding the transport type based on environment variables or feature flags.
- Adding business logic (signal routing, phase dispatch) to transport implementations — transport only moves messages.
- Assuming the bus is always active (always check via `get transport status` before publishing).

## Review Focus

- No direct imports of transport implementations outside this Mind.
- Transport auto-detection through `resolveTransportPath()` — no manual conditional in callers.
- New transport implementations conform to the `Transport` interface.
- Error messages include channel name and transport type.
