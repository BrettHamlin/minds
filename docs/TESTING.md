# Testing Guide

## Running Tests

**`bun test` is banned.** It crashes Claude Code due to a bun bug ([oven-sh/bun#11055](https://github.com/oven-sh/bun/issues/11055)). Always use the test helper script.

```bash
scripts/run-tests.sh minds/lib/                    # test a directory
scripts/run-tests.sh minds/shared/                 # test a directory
scripts/run-tests.sh minds/lib/contracts.test.ts   # test a single file
scripts/run-tests.sh                               # full suite (defaults to minds/)
```

The helper runs tests in a separate tmux window, captures output to `/tmp/gravitas-test-result.txt`, and reports pass/fail counts. Requires an active tmux session.

---

## Test Organization

Tests are colocated with source code in `__tests__/` directories or as `*.test.ts` files alongside their source. All tests use `bun:test` (Bun's built-in test runner).

---

## Test Directory Map

### Shared Utilities (`minds/shared/__tests__/`)

| Test File | Covers | Run When You Change |
|-----------|--------|---------------------|
| `paths.test.ts` | `matchesOwnership`, `normalizeMindsPrefix`, `containsPathTraversal` | `minds/shared/paths.ts` |
| `paths-repo-prefix.test.ts` | `matchesOwnership` with repo-prefixed patterns | `minds/shared/paths.ts` |
| `repo-path.test.ts` | `parseRepoPath`, `stripRepoPrefix`, `hasRepoPrefix` | `minds/shared/repo-path.ts` |
| `workspace.test.ts` | Workspace manifest schema validation | `minds/shared/workspace.ts` |
| `workspace-loader.test.ts` | Manifest discovery, resolution, env override | `minds/shared/workspace-loader.ts` |

### Core Libraries (`minds/lib/__tests__/`)

| Test File | Covers | Run When You Change |
|-----------|--------|---------------------|
| `contracts-repo-parse.test.ts` | `sectionRepo` parsing from task headers | `minds/lib/contracts.ts` |
| `contracts-owns-regex.test.ts` | Ownership regex with repo prefixes | `minds/lib/contracts.ts` |
| `contracts-cross-repo.test.ts` | Cross-repo contract verification | `minds/lib/check-contracts-core.ts` |
| `contracts-lint-multirepo.test.ts` | Multi-repo lint checks (repo_unknown, cross_repo, etc.) | `minds/lib/contracts.ts` |
| `assemble-claude-content.test.ts` | `assembleClaudeContent` extraction | `minds/lib/drone-pane.ts` |
| `drone-pane-multirepo.test.ts` | Drone pane spawning with multi-repo flags | `minds/lib/drone-pane.ts` |
| `drone-context-multirepo.test.ts` | Drone context with repo fields | `minds/lib/drone-pane.ts` |
| `cleanup-multirepo.test.ts` | Multi-repo cleanup and worktree pruning | `minds/lib/cleanup.ts` |
| `merge-drone-events.test.ts` | Merge drone event publishing | `minds/lib/merge-drone.ts` |
| `tmux-multiplexer.test.ts` | Tmux pane operations | `minds/lib/tmux-multiplexer.ts` |
| `tmux-utils.test.ts` | Tmux utility functions | `minds/lib/tmux-utils.ts` |
| `review-drone.test.ts` | Review drone logic | `minds/lib/review-drone.ts` |

Also at module root: `cleanup.test.ts`, `contracts.test.ts`, `drone-pane.test.ts`, `merge-drone.test.ts`, `mind-pane.test.ts`

### Supervisor (`minds/lib/supervisor/__tests__/`)

| Test File | Covers | Run When You Change |
|-----------|--------|---------------------|
| `mind-supervisor.test.ts` | Full supervisor loop (mock deps) | `minds/lib/supervisor/mind-supervisor.ts` |
| `mind-supervisor-integration.test.ts` | Supervisor integration scenarios | `minds/lib/supervisor/mind-supervisor.ts` |
| `supervisor-state-machine.test.ts` | State machine transitions | `minds/lib/supervisor/supervisor-state-machine.ts` |
| `supervisor-drone.test.ts` | Drone spawning, relaunch, completion | `minds/lib/supervisor/supervisor-drone.ts` |
| `supervisor-drone-multirepo.test.ts` | Multi-repo drone brief and flags | `minds/lib/supervisor/supervisor-drone.ts` |
| `supervisor-checks.test.ts` | Deterministic checks (diff, tests, boundary) | `minds/lib/supervisor/supervisor-checks.ts` |
| `supervisor-checks-multirepo.test.ts` | Checks with repo-qualified paths and custom testCommand | `minds/lib/supervisor/supervisor-checks.ts` |
| `supervisor-review.test.ts` | Review prompt building, verdict parsing | `minds/lib/supervisor/supervisor-review.ts` |
| `boundary-check.test.ts` | Boundary enforcement (owns_files matching) | `minds/lib/supervisor/boundary-check.ts` |
| `boundary-check-multirepo.test.ts` | Boundary check with repo-prefixed paths | `minds/lib/supervisor/boundary-check.ts` |
| `cross-repo-contracts.test.ts` | Post-wave cross-repo contract verification | `minds/lib/supervisor/cross-repo-contracts.ts` |
| `supervisor-bus-shape.test.ts` | Bus signal payload shapes | `minds/lib/supervisor/supervisor-bus.ts` |
| `supervisor-findings-accumulation.test.ts` | Finding accumulation across iterations | `minds/lib/supervisor/mind-supervisor.ts` |
| `supervisor-agent.test.ts` | Supervisor agent behavior | `minds/lib/supervisor/` |

### CLI (`minds/cli/`)

| Test File | Covers | Run When You Change |
|-----------|--------|---------------------|
| `__tests__/drone-brief.test.ts` | Drone brief template generation | `minds/cli/lib/drone-brief.ts` |
| `__tests__/task-parser.test.ts` | Task markdown parsing | `minds/cli/lib/task-parser.ts` |
| `__tests__/wave-planner.test.ts` | Wave/dependency planning (Kahn's sort) | `minds/cli/lib/wave-planner.ts` |
| `lib/__tests__/implement-types-repo.test.ts` | Types with optional repo field | `minds/cli/lib/implement-types.ts` |
| `lib/mind-brief.test.ts` | Mind brief generation | `minds/cli/lib/mind-brief.ts` |
| `lib/resolve-owns.test.ts` | Ownership resolution | `minds/cli/lib/resolve-owns.ts` |

### Implement Command (`minds/cli/commands/__tests__/`)

| Test File | Covers | Run When You Change |
|-----------|--------|---------------------|
| `implement-workspace.test.ts` | Workspace loading in implement flow | `minds/cli/commands/implement.ts` |
| `implement-multi-repo.test.ts` | Full multi-repo flow (16 tests) | `minds/cli/commands/implement.ts` |
| `implement-single-repo-compat.test.ts` | Backward compat without workspace manifest | `minds/cli/commands/implement.ts` |
| `implement-registry-multirepo.test.ts` | Multi-repo registry merging | `minds/cli/commands/implement.ts` |
| `implement-merge-multirepo.test.ts` | Per-repo grouped merge | `minds/cli/commands/implement.ts` |
| `implement-toolchain.test.ts` | Per-repo testCommand/installCommand | `minds/cli/commands/implement.ts` |
| `implement-scaffold.test.ts` | Scaffold and setup steps | `minds/cli/commands/implement.ts` |
| `coverage.test.ts` | Coverage tracking | `minds/cli/commands/implement.ts` |
| `helpers/multi-repo-setup.ts` | Shared fixture factory (not a test file — imported by tests above) | — |

### Transport / Bus (`minds/transport/__tests__/`)

Bus server, SSE, event publishing, aggregator, state tracking. Run when changing anything in `minds/transport/`.

### Other Modules

| Directory | Covers |
|-----------|--------|
| `minds/coordination/` | Dependency holds, question resolution, group management |
| `minds/dashboard/` | Dashboard DB, state tracker, route handler |
| `minds/execution/` | Pipeline phases, gate evaluation, registry, signal validation |
| `minds/fission/` | Code analysis, language extractors, mind scaffolding |
| `minds/memory/` | Embeddings, search, contract store, hygiene |
| `minds/observability/` | Metrics, run classification, PR creation |
| `minds/pipelang/` | Pipeline language (DSL) parser and runner |
| `minds/signals/` | Signal emission and contracts |

---

## Changed X → Run Y

Quick reference for the most common changes:

| You changed... | Run this |
|----------------|----------|
| `minds/shared/paths.ts` | `scripts/run-tests.sh minds/shared/` |
| `minds/shared/workspace.ts` or `workspace-loader.ts` | `scripts/run-tests.sh minds/shared/` |
| `minds/shared/repo-path.ts` | `scripts/run-tests.sh minds/shared/` |
| `minds/lib/contracts.ts` or `check-contracts-core.ts` | `scripts/run-tests.sh minds/lib/` |
| `minds/lib/drone-pane.ts` | `scripts/run-tests.sh minds/lib/` |
| `minds/lib/cleanup.ts` or `merge-drone.ts` | `scripts/run-tests.sh minds/lib/` |
| `minds/lib/supervisor/*.ts` | `scripts/run-tests.sh minds/lib/supervisor/` |
| `minds/cli/lib/drone-brief.ts` | `scripts/run-tests.sh minds/cli/` |
| `minds/cli/lib/task-parser.ts` | `scripts/run-tests.sh minds/cli/` |
| `minds/cli/lib/wave-planner.ts` | `scripts/run-tests.sh minds/cli/` |
| `minds/cli/commands/implement.ts` | `scripts/run-tests.sh minds/cli/commands/` |
| `minds/transport/*.ts` | `scripts/run-tests.sh minds/transport/` |
| Anything in `minds/` (broad change) | `scripts/run-tests.sh` (full suite) |

---

## E2E Tests

The E2E test runner validates the full `minds implement` pipeline end-to-end with real git repos, real Claude Code drones, and real tmux pane splitting.

### Prerequisites

- Active tmux session (the script checks `$TMUX`)
- `bun` installed
- `claude` CLI installed (for drone spawning)

### Running

```bash
scripts/e2e-multi-repo.sh           # run all 3 scenarios
scripts/e2e-multi-repo.sh 1         # run only scenario 1
scripts/e2e-multi-repo.sh 2         # run only scenario 2
scripts/e2e-multi-repo.sh 3         # run only scenario 3
```

### Scenarios

| # | Name | What It Tests |
|---|------|---------------|
| 1 | Happy Path | 2 repos (frontend + backend), cross-repo dependency, 2 waves |
| 2 | Backward Compat | Single repo, no workspace manifest, single mind |
| 3 | N>2 Repos | 3 repos (frontend + backend + shared), parallel minds in wave 2 |

Each scenario:
1. Creates temp git repos with minds.json, tasks.md, and source files
2. Runs `minds implement` in a dedicated tmux window
3. Checks for the success marker in the output log
4. Cleans up repos, worktrees, and bus processes

### Typical runtime

- Scenario 1: 3-5 minutes
- Scenario 2: 3-5 minutes
- Scenario 3: 5-10 minutes (parallel minds, potential retry iterations)
- Full suite: 10-20 minutes

### Port conflicts

The dashboard binds to port 3737. The script cleans up between scenarios, but if a previous run left orphaned processes:

```bash
pkill -f "status-aggregator"
lsof -ti:3737 | xargs kill -9
```
