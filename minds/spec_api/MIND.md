# @spec_api Mind Profile

## Domain

HTTP REST API gateway for spec creation workflows. This Mind is a thin routing layer that discovers `SpecEngine` as a child Mind and delegates all business logic to it. It also runs the Express HTTP server.

## Conventions

- **Thin gateway pattern** — `spec_api` validates HTTP inputs and formats HTTP responses. It does not contain business logic. All spec creation, validation, and processing belongs in `SpecEngine`.
- `SpecEngine` is discovered via `discoverChildren(import.meta.dir)` — never hardcode the engine's port or path.
- `engine.ts` holds the `setEngine()` / `getEngine()` singleton for the discovered child — always use these accessors.
- HTTP input validation happens at the boundary in `spec_api` before forwarding to the engine — do not let invalid inputs reach the child.
- Response formatting (status codes, error shapes) is the responsibility of `spec_api`, not `SpecEngine`.

## Key Files

- `minds/spec_api/server.ts` — Mind definition, `ensureEngine()`, request delegation
- `minds/spec_api/engine.ts` — SpecEngine child singleton (`setEngine`, `getEngine`)

## Anti-Patterns

- Adding spec creation or validation logic directly to `spec_api` (belongs in SpecEngine).
- Calling `SpecEngine` directly from other Minds — always go through `spec_api`'s exposed interface.
- Hardcoding the SpecEngine port or spawn path (use `discoverChildren()`).
- Letting unvalidated HTTP inputs pass through to the child without boundary checks.

## Review Focus

- All business logic delegated to SpecEngine — `spec_api` files contain only routing and I/O shaping.
- `ensureEngine()` called before every delegation (child may not yet be discovered).
- HTTP errors return structured responses (not raw exceptions).
