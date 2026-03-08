# Shared Engineering Standards

All Minds inherit these standards. Include in every Drone brief. Drone output that violates these standards fails review.

---

## Deterministic First

**If it CAN be deterministic TypeScript, it MUST be deterministic TypeScript.**

Deterministic code is testable, produces exact repeatable outcomes, and is the foundation of a production system. LLMs (Minds and Drones) handle only what requires judgment — code review, design decisions, analysis, creative problem-solving.

**Deterministic TypeScript handles:**
- Git operations (commit, merge, branch management)
- File manipulation (section updates, config reads, path resolution)
- Signal names, phase transitions, validation, routing
- Schema construction and validation
- Pipeline config reading and interpretation
- Retry counts, execution mode detection, dependency holds
- Any value or operation that MUST be correct every time

**LLM (Mind/Drone) handles ONLY:**
- Code reviews, analysis, creative decisions — anything requiring judgment
- Deciding pass/fail verdicts (the judgment call, not the format)
- Writing implementation code, spec content, plan content
- Problem diagnosis and guidance when drones are stuck

**When in doubt, make it deterministic.** If something CAN be code, it SHOULD be code. Shell one-liners for non-trivial logic are a code smell — write a TypeScript utility with tests instead.

## Code Quality

- **DRY** — no duplicated logic. If the function exists elsewhere in the codebase, import it. Before writing a utility, search for it.
- **Single Responsibility** — each function does one thing. Each module owns one concern.
- **No dead code** — no commented-out code, no unused imports, no TODOs without a ticket reference (e.g., `// TODO(BRE-123): ...`).
- **Explicit over implicit** — name things clearly. Avoid abbreviations unless they are universal in this codebase (`ticketId`, `repoRoot`, `phaseName`).
- **No hardcoded values** that should come from config, registry, or pipeline — use the existing resolution utilities.

## Testing

### Unit Tests (Drone responsibility)
- Every new exported function gets at least one test.
- Tests verify **behavior**, not implementation details — test what it returns, not how it does it.
- Mock external dependencies (`Bun.spawn`, filesystem, HTTP) — do not mock internal modules.
- Cover edge cases: empty input, missing files, invalid data, unknown phase names.
- Test files live alongside source files: `foo.ts` → `foo.test.ts`.
- All unit tests must pass before reporting DRONE_COMPLETE.

### Integration / E2E Tests (post-merge, Mind responsibility)
- Integration tests span multiple Minds' domains and run after all Minds' work is merged.
- The Mind does NOT run integration tests during drone review — unit tests are sufficient for review.
- Integration and E2E tests are a separate step that runs after all waves complete and merge.
- **Tests must run the way a real user would run it. No fixtures, no mocks, no simulated environments.** Real-world execution:
  - Web features → Playwright browser automation (the Browser/Playwright skill)
  - iOS features → actual simulator (the iOS verify skill)
  - Pipeline/collab flows → spawn a tmux window, launch Claude Code in dangerous mode, run the flow end-to-end, monitor for completion
  - CLI commands → actually run the command and verify output
- If integration tests fail, the issue is triaged back to the responsible Mind(s) for fixing.
- **Every feature must have real-world test coverage.** Unit tests alone are not sufficient to ship.

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

## Memory Flush on Completion

After a Mind completes its review cycle, it writes learnings to its own daily log via the Memory Mind CLI:

```bash
bun minds/memory/lib/write-cli.ts --mind <name> --content "<insight text>"
```

**Rules:**
- This is a **Mind responsibility**, not a drone responsibility. Drones are ephemeral and do not have memory access.
- Write concrete, durable insights: architectural decisions, pattern violations found, DRY opportunities identified, edge cases discovered.
- Do NOT write in-progress state or session context — only stable learnings worth preserving across future review cycles.
- Flush after every review cycle that produces at least one reviewable finding or decision.
- For multi-finding reviews, a single write call with all insights concatenated is acceptable.

**When to flush:**
- After passing a Drone's code changes through the review checklist.
- After identifying a violation that required re-dispatch.
- After discovering a contract gap or cross-Mind dependency issue.

**When NOT to flush:**
- Trivial passes with nothing new (boilerplate, no decisions made).
- Session-specific context that won't apply to future reviews.

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
- [ ] Deterministic-first: no shell one-liners for non-trivial logic — use TypeScript utilities with tests
