# Project-Specific Engineering Standards

These standards extend the generic STANDARDS.md with project-specific conventions.
This file is NOT shipped by the installer — each project creates their own.

---

## Deterministic TypeScript

Shell one-liners for non-trivial logic are a code smell — write a TypeScript utility with tests instead.

**Deterministic TypeScript handles:**
- Signal names, phase transitions, validation, routing
- Schema construction and validation
- Pipeline config reading and interpretation
- Retry counts, execution mode detection, dependency holds

## TypeScript / Bun Conventions

- Use `import type` for type-only imports.
- Async functions must declare return types: `async function foo(): Promise<Bar>`.
- Throw typed errors with context: `throw new Error(\`resolveTransition: unknown signal "${signal}" in phase "${phase}"\`)` — not `throw new Error("failed")`.
- Export types alongside the functions that use them.
- Run with Bun. No Node-only APIs. No external npm packages unless already in package.json.

## Test Scoping (CRITICAL)

- Drones run `bun test minds/{mind_name}/` — NOT bare `bun test`. Bare `bun test` runs all 162+ test files across the entire repo, takes 3-5+ minutes, and can hang indefinitely.
- When creating new test files, run those specific files: `bun test minds/{mind_name}/path/to/new.test.ts`.
- The drone's CLAUDE.md includes a `## Test Command` section with the correct scoped command — use it.
- Available npm scripts: `test` (tests/ only), `test:minds` (minds/ only), `test:unit` (unit tests only), `test:all` (everything — use sparingly).

## Integration / E2E Tests (post-merge, Mind responsibility)

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

## Additional Review Checklist Items

- [ ] `import type` used for type-only imports
- [ ] Deterministic-first: no shell one-liners for non-trivial logic — use TypeScript utilities with tests
