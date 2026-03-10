# @installer Mind Profile

## Domain

Minds architecture installation: copying core Minds and shared infrastructure into target repos' `.minds/` directory, managing install paths, handling upgrade scenarios.

## Conventions

- `installCoreMinds(mindsSourceDir, repoRoot, opts)` in `core.ts` is the single install function — all install logic flows through it.
- Install is **idempotent by default** — existing files are not overwritten unless `force: true` is passed.
- Source directory resolved via `getMindsSourceDir()` — never hardcode the path.
- Dashboard build step runs automatically when Bun is available.
- Dev artifacts (node_modules, dist, .turbo, bun.lock) are never copied.

## Key Files

- `minds/installer/core.ts` — `installCoreMinds()`, `getMindsSourceDir()`, copy logic
- `minds/installer/server.ts` — Mind server entry point

## Anti-Patterns

- Hardcoding the source directory path (use `getMindsSourceDir()`).
- Overwriting files without checking `opts.force` (install must be idempotent).
- Adding collab pipeline template logic (removed in BRE-466).
- Adding business logic (gate evaluation, pipeline loading) to the installer — this Mind only copies files.

## Review Focus

- Install is idempotent — running twice with the same inputs produces the same result.
- All file paths derived from `getMindsSourceDir()` and `repoRoot`, not hardcoded.
- No logic beyond file copying — any pipeline behavior belongs elsewhere.
