# @signals Mind Profile

## Domain

Signal emission: phase signal handlers, transport dispatch, token resolution, and the question signal hook. This Mind owns the per-phase `emit-*-signal.ts` handlers and the shared `emit-phase-signal.ts` + `pipeline-signal.ts` utilities.

## Conventions

- **Signal names always use `resolveSignalName()`** from `pipeline-signal.ts` — never construct `CLARIFY_COMPLETE` or similar names via string concatenation.
- `emit-phase-signal.ts` is the shared entry point for all phase signal emission — per-phase handlers (`emit-clarify-signal.ts`, etc.) delegate to it.
- `emit-signal.ts` is the generic CLI handler (reads phase from registry) — new per-phase CLIs should wrap it, not duplicate its logic.
- Token resolution (`resolve-tokens.ts`) replaces `{{TICKET_ID}}` and similar placeholders in pipeline config strings — always run before passing config values to agents.
- Signal nonces prevent duplicate processing — include the nonce when constructing signal payloads.
- `emit-findings.ts` enforces the `FindingsBatch` schema — use it, do not construct findings JSON manually.

## Key Files

- `minds/signals/emit-phase-signal.ts` — shared signal emission entry point
- `minds/signals/pipeline-signal.ts` — `resolveSignalName()`, `SIGNAL_SUFFIXES`
- `minds/signals/emit-signal.ts` — generic CLI signal handler
- `minds/signals/emit-findings.ts` — FindingsBatch schema enforcement
- `minds/signals/resolve-tokens.ts` — `{{TOKEN}}` replacement in config strings
- `minds/hooks/PreToolUse.question-signal.ts` — Q&A question signal hook (installed to `.claude/hooks/`)

## Anti-Patterns

- Constructing signal names as string concatenation (`phase + "_COMPLETE"`) — use `resolveSignalName()`.
- Building findings JSON by hand instead of using `emit-findings.ts`.
- Duplicating token resolution logic inline instead of calling `resolve-tokens.ts`.
- Skipping nonce generation (causes duplicate signal processing).

## Review Focus

- Every signal name goes through `resolveSignalName()` — zero raw string constructions.
- Findings always validated through `emit-findings.ts` (FindingsBatch schema enforced).
- Token replacement applied to all config strings passed to agents.
- Signal nonces present in all emitted payloads.
