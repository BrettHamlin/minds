# @cli Mind Profile

## Domain

The `gravitas` binary: argument parsing, package registry, repo path management, semver resolution, lockfile, and integrity checking. This Mind owns both CLI entry points and all supporting lib/utils.

## Conventions

- **Two entry points must stay in sync**: `cli/bin/collab.ts` (commander-based, npm package) and `minds/cli/index.ts` (manual arg parsing, compiled binary). New subcommands go in both.
- Subcommand modules live in `minds/cli/commands/` — one file per subcommand group.
- Lib modules (`registry.ts`, `resolver.ts`, `integrity.ts`, `lockfile.ts`, `semver.ts`, `state.ts`) are pure functions — no side effects, no I/O unless explicitly required.
- Use `ensureDir` from `minds/cli/utils/fs.ts` for directory creation — do not call `fs.mkdirSync` directly.

## Key Files

- `minds/cli/index.ts` — compiled binary entry point (manual arg parsing)
- `minds/cli/bin/collab.ts` — npm package entry point (commander-based)
- `minds/cli/lib/registry.ts` — pack registry fetch/parse
- `minds/cli/lib/resolver.ts` — version resolution logic
- `minds/cli/lib/integrity.ts` — checksum verification
- `minds/cli/types/index.ts` — shared types for this Mind

## Anti-Patterns

- Adding a subcommand to only one entry point (both must have it).
- Importing from other Minds' internals — this Mind has no `consumes` dependencies.
- Adding business logic directly to the CLI handler instead of delegating to a lib module.
- Using `process.exit()` outside the top-level CLI entry point.

## Review Focus

- Both entry points updated consistently for any new subcommand.
- Lib functions are pure (no hidden I/O or global state).
- Semver comparisons use `minds/cli/lib/semver.ts`, not inline string parsing.
