# @instantiate Mind Profile

## Domain

Mind lifecycle — scaffolding new Minds in any repo. Creates the directory structure (`MIND.md`, `server.ts`, `lib/`) and registers the new Mind in `minds.json`. Works in both dev repos (`minds/`) and installed repos (`.minds/`).

## Conventions

- **Single intent: `create-mind`** — takes `name` (lowercase, no spaces) and `domain` (human-readable description).
- **Path resolution is portable**: `mindsSourceDir()` locates the Minds source directory — `.minds/` for installed repos, `minds/` (relative to git root) for dev repos.
- **Registration uses `mindsRoot()`** from `@minds/shared/paths.js` to locate `minds.json` — `.minds/minds.json` (installed) or `.collab/minds.json` (dev).
- **Atomic writes**: `minds.json` is written to a `.tmp` file then renamed — never partial writes.
- **Idempotent name check**: scaffold throws if the Mind directory already exists.
- **Name validation**: must match `^[a-z][a-z0-9-]*$` — lowercase, starts with letter.

## Key Files

- `minds/instantiate/server.ts` — Mind server entry point
- `minds/instantiate/lib/scaffold.ts` — `scaffoldMind()`, `mindsSourceDir()`, `mindsJsonPath()`, template generators

## Anti-Patterns

- Hardcoding `minds/` or `.minds/` paths — always use `mindsSourceDir()` for source location.
- Hardcoding `.collab/minds.json` — always use `mindsJsonPath()` (delegates to `mindsRoot()`).
- Non-atomic `minds.json` writes — always write to `.tmp` then rename.
- Allowing overwrite of existing Mind directories — throw with a clear error.

## Review Focus

- `mindsSourceDir()` correctly resolves both `.minds/` (installed) and `minds/` (dev) layouts.
- `mindsJsonPath()` delegates to `mindsRoot()` — no hardcoded paths.
- Generated `MIND.md` contains the correct name and domain.
- Generated `server.ts` compiles and uses `createMind()` with working `describe()`.
- Atomic write: `.tmp` → rename — never partial minds.json.
- Error messages include which field is missing and which intent triggered the error.
