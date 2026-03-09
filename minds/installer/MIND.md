# @installer Mind Profile

## Domain

Gravitas distribution: copying template files into target repos, managing install paths, handling upgrade scenarios, and providing the runtime gravitas-install script. This Mind turns the gravitas source into a working `.gravitas/` installation in any repo.

## Conventions

- `installTemplates(templateDir, repoRoot, opts)` in `core.ts` is the single install function — all install logic flows through it.
- Install is **idempotent by default** — existing files are not overwritten unless `force: true` is passed.
- Template source is `getTemplateDir()` — never hardcode the template path.
- Directory creation uses `ensureDir` from `cli/ensureDir` (consumed from the CLI Mind) — do not call `fs.mkdirSync` inline.
- File mappings are declarative: source path → destination path. No dynamic path construction in the copy loop.

## Key Files

- `minds/installer/core.ts` — `installTemplates()`, `getTemplateDir()`, file mapping logic
- `minds/installer/collab-install.ts` — the runtime installer (run in target repos)

## Anti-Patterns

- Hardcoding the template directory path (use `getTemplateDir()`).
- Overwriting files without checking `opts.force` (install must be idempotent).
- Adding business logic (gate evaluation, pipeline loading) to the installer — this Mind only moves files.
- Calling `fs.mkdirSync` directly instead of using `ensureDir` from CLI Mind.

## Review Focus

- Install is idempotent — running twice with the same inputs produces the same result.
- All file paths derived from `getTemplateDir()` and `repoRoot`, not hardcoded.
- No logic beyond file mapping and copying — any pipeline behavior belongs in `execution`.
