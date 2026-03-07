# @integrations Mind Profile

## Domain

External service adapters: Slack (primary), with Discord and Teams as future targets. Handles outbound messaging, channel management, and user lookups. All communication is outward-only via HTTP/SDK — no other Mind imports from this one directly.

## Conventions

- **Adapter pattern only** — each integration is a thin adapter over its SDK. No business logic here.
- All Slack operations go through `minds/integrations/slack/client.ts` for the app instance and `minds/integrations/slack/interactions.ts` for message composition.
- No direct imports from pipeline_core, execution, or signals — this Mind is isolated by design.
- HTTP errors from Slack SDK must be caught and re-thrown with context (include channel ID and operation name in the error message).
- Future integrations (Discord, Teams) follow the same adapter pattern: one `client.ts` + one `interactions.ts` per service.

## Key Files

- `minds/integrations/slack/client.ts` — Slack app instance + auth
- `minds/integrations/slack/interactions.ts` — message formatting and channel posting

## Anti-Patterns

- Adding pipeline state logic (phase checks, registry reads) to an adapter.
- Importing from `pipeline_core`, `execution`, or `signals` — this Mind has no `consumes`.
- Swallowing Slack SDK errors silently (always re-throw with context).
- Hardcoding channel IDs or bot tokens (these come from environment variables or config).

## Review Focus

- Each adapter is stateless (no module-level mutable state except the SDK app instance).
- Error messages include the operation and relevant IDs (channel, user).
- New integrations follow the `client.ts` + `interactions.ts` file structure.
