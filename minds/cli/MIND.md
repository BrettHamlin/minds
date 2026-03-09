# @cli Mind Profile

## Domain

The `minds` CLI: installs core Minds into target repositories. Minimal surface area with a single `init` command.

## Conventions

- **Two entry points must stay in sync**: `minds/cli/bin/minds.ts` (commander-based) and `minds/cli/index.ts` (manual arg parsing). New subcommands go in both.
- Subcommand modules live in `minds/cli/commands/` — one file per subcommand.
- Delegates all installation logic to `minds/installer/core.ts`.

## Key Files

- `minds/cli/index.ts` — compiled binary entry point (manual arg parsing)
- `minds/cli/bin/minds.ts` — npm package entry point (commander-based)
- `minds/cli/commands/minds-init.ts` — init command implementation

## Anti-Patterns

- Adding a subcommand to only one entry point (both must have it).
- Adding installation logic directly to the CLI handler instead of delegating to `installer/core.ts`.
- Re-adding collab pipeline commands (removed in BRE-466).
