# Shared Engineering Standards

All Minds inherit these standards. Drone output that violates these standards fails review.

---

## Deterministic First

**If it CAN be deterministic code, it MUST be deterministic code.**

Deterministic code is testable, produces exact repeatable outcomes, and is the foundation of a production system. LLMs (Minds and Drones) handle only what requires judgment — code review, design decisions, analysis, creative problem-solving.

**Deterministic code handles:**
- Git operations (commit, merge, branch management)
- File manipulation (section updates, config reads, path resolution)
- Signal names, phase transitions, validation, routing
- Schema construction and validation
- Config reading and interpretation
- Retry counts, execution mode detection, dependency holds
- Any value or operation that MUST be correct every time

**LLM (Mind/Drone) handles ONLY:**
- Code reviews, analysis, creative decisions — anything requiring judgment
- Deciding pass/fail verdicts (the judgment call, not the format)
- Writing implementation code, spec content, plan content
- Problem diagnosis and guidance when drones are stuck

**When in doubt, make it deterministic.** If something CAN be code, it SHOULD be code.

## Code Quality

- **DRY** — no duplicated logic. If the function exists elsewhere in the codebase, import it. Before writing a utility, search for it.
- **Single Responsibility** — each function does one thing. Each module owns one concern.
- **No dead code** — no commented-out code, no unused imports, no TODOs without a ticket reference.
- **Explicit over implicit** — name things clearly. Avoid abbreviations unless they are universal in this codebase.
- **No hardcoded values** that should come from config, registry, or pipeline — use the existing resolution utilities.

## Testing

- Every new exported function gets at least one test.
- Tests verify **behavior**, not implementation details — test what it returns, not how it does it.
- Mock external dependencies (process spawning, filesystem, HTTP) — do not mock internal modules.
- Cover edge cases: empty input, missing files, invalid data.
- Test files live alongside source files: `foo.ts` → `foo.test.ts` (or language equivalent).
- All unit tests must pass before the drone reports completion.

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

- [ ] All tasks completed
- [ ] No files modified outside `owns_files`
- [ ] No duplicated logic (verify against existing codebase before accepting new utilities)
- [ ] All new exported functions have tests
- [ ] All tests pass
- [ ] No lint errors
- [ ] Interface contracts honored — `exposes` are exported at their declared paths, `consumes` are imported (not reimplemented)
- [ ] No hardcoded values that should come from config or registry
- [ ] Error messages include context (not just "failed" or "error")
