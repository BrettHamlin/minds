# Shared Engineering Standards

All Minds inherit these standards. Include in every Drone brief. Drone output that violates these standards fails review.

---

## Code Quality

- **DRY** — no duplicated logic. If the function exists elsewhere in the codebase, import it. Before writing a utility, search for it.
- **Single Responsibility** — each function does one thing. Each module owns one concern.
- **No dead code** — no commented-out code, no unused imports, no TODOs without a ticket reference (e.g., `// TODO(BRE-123): ...`).
- **Explicit over implicit** — name things clearly. Avoid abbreviations unless they are universal in this codebase (`ticketId`, `repoRoot`, `phaseName`).
- **No hardcoded values** that should come from config, registry, or pipeline — use the existing resolution utilities.

## Testing

- Every new exported function gets at least one test.
- Tests verify **behavior**, not implementation details — test what it returns, not how it does it.
- Mock external dependencies (`Bun.spawn`, filesystem, HTTP) — do not mock internal modules.
- Cover edge cases: empty input, missing files, invalid data, unknown phase names.
- Test files live alongside source files: `foo.ts` → `foo.test.ts`.

## TypeScript / Bun Conventions

- Use `import type` for type-only imports.
- Async functions must declare return types: `async function foo(): Promise<Bar>`.
- Throw typed errors with context: `throw new Error(\`resolveTransition: unknown signal "${signal}" in phase "${phase}"\`)` — not `throw new Error("failed")`.
- Export types alongside the functions that use them.
- Run with Bun. No Node-only APIs. No external npm packages unless already in package.json.

## File Boundaries

- **NEVER modify files outside your `owns_files` boundary.** If a change is needed in another Mind's files, declare a contract gap and stop.
- **NEVER reimplement** something another Mind exposes. Find the export path from `minds.json` and import it.
- If you need something that doesn't exist yet in a declared `exposes`, that is a contract gap — document it and stop. Do not work around it.

---

## Review Checklist

The Mind uses this checklist when reviewing Drone output before accepting it.

- [ ] All tasks marked `[X]` in tasks.md
- [ ] No files modified outside `owns_files`
- [ ] No duplicated logic (verify against existing codebase before accepting new utilities)
- [ ] All new exported functions have tests
- [ ] All tests pass (`bun test`)
- [ ] No lint errors
- [ ] Interface contracts honored — `exposes` are exported at their declared paths, `consumes` are imported (not reimplemented)
- [ ] No hardcoded values that should come from config or registry
- [ ] Error messages include context (not just "failed" or "error")
- [ ] `import type` used for type-only imports
