# Issues & Recommendations

**Last verified**: 2026-02-21

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| High | 5 |
| Medium | 6 |
| Low | 5 |

---

## Critical Issues

### 1. Hardcoded Webhook Token in Source Code

**Category**: Security
**Files**: `src/scripts/webhook-notify.sh` (line 19)
**Description**: The webhook authentication token `63010287709179dece1406557973ad6415e7e548420069b43821c54b49598170` is hardcoded directly in the source file. This file is committed to git and distributed via `collab.install.sh` to any repo that installs collab, leaking the token to all consumers.
**Impact**: Anyone who installs collab gets the OpenClaw webhook bearer token. If the repo is public or shared broadly, this token is exposed. An attacker could send arbitrary notifications to the Discord channel.
**Remediation**: Move the token to an environment variable (e.g., `COLLAB_HOOKS_TOKEN`). Update `webhook-notify.sh` to read from `$COLLAB_HOOKS_TOKEN` with a fallback error message if unset. Add the variable to `.env.example`.

---

## High Priority

### 2. Four .specify/ Scripts Have No src/ Source of Truth

**Category**: Sync
**Files**:
- `.specify/scripts/bash/check-prerequisites.sh` -- NO `src/.specify/` equivalent
- `.specify/scripts/bash/common.sh` -- NO `src/.specify/` equivalent
- `.specify/scripts/bash/setup-plan.sh` -- NO `src/.specify/` equivalent
- `.specify/scripts/bash/update-agent-context.sh` -- NO `src/.specify/` equivalent

**Description**: The collab constitution (Principle I: Source Directory Authority) states that `src/` is the canonical source of truth and runtime directories are populated from it. However, four scripts exist only in `.specify/scripts/bash/` with no corresponding files in `src/.specify/scripts/bash/`. The `src/.specify/scripts/bash/` directory contains only `create-new-feature.sh` and `test-ticket-extraction.sh`.

The install script (`collab.install.sh` line 89) copies from `.specify/scripts/*` during remote install -- meaning it copies from the runtime location of the *source repo*, not from `src/.specify/`. This works for the collab repo itself but violates the src/ authority principle.

**Impact**: These files can only be edited in the runtime location. If the install script is ever changed to copy from `src/.specify/`, these four files will be silently dropped. New contributors following the "edit src/ only" rule will not find these files.

**Remediation**: Copy all four files to `src/.specify/scripts/bash/`. Update the install script to copy from `src/.specify/` instead of `.specify/`. This is documented in MEMORY.md as a known TODO.

---

### 3. Install Script Handler Destination Inconsistency

**Category**: Sync
**Files**:
- `scripts/install.sh` (legacy) deploys handlers to `.claude/hooks/handlers/`
- `src/commands/collab.install.sh` (current) deploys handlers to `.collab/handlers/`
- Signal handlers reference `.collab/handlers/` paths at runtime

**Description**: Two install scripts exist with different handler deployment targets. The legacy `scripts/install.sh` installs handlers to `.claude/hooks/handlers/`, while the current `src/commands/collab.install.sh` installs them to `.collab/handlers/`. The signal emission handlers (`emit-question-signal.ts`, etc.) and the orchestrator commands reference `.collab/handlers/` as the runtime path. The legacy install script would deploy to the wrong location.

**Impact**: If someone uses `scripts/install.sh` instead of `collab.install.sh`, handlers will be installed to the wrong directory and signal emission will fail silently.

**Remediation**: Either delete `scripts/install.sh` entirely (it is the legacy version) or update it to match `collab.install.sh` handler paths. Recommend deletion since `collab.install.sh` is the authoritative install path.

---

### 4. Deprecated pipeline.v2 Files Deployed but Never Used

**Category**: Dead Code
**Files**:
- `.collab/config/pipeline.v2.json`
- `.collab/config/pipeline.v2.schema.json`

**Description**: Both files exist in the `.collab/config/` runtime directory but have NO corresponding source files in `src/config/`. The active pipeline uses v3 (`pipeline.json` with `"version": "3.0"`). The `orchestrator-init.sh` validates against `pipeline.v3.schema.json` exclusively. No script, handler, or command references v2 files.

These files are NOT deployed by `collab.install.sh` (the install script copies `src/config/pipeline.json` and `src/config/*.schema.json` -- since v2 files do not exist in `src/config/`, they are never copied). They appear to be leftover from a manual migration in the collab repo itself.

**Impact**: Confusion for developers who might think v2 is still active. Occupies config directory space. No functional impact since nothing reads them.

**Remediation**: Delete both files from `.collab/config/`. They are not in `src/config/` and will never be re-deployed.

---

### 5. README.md Describes "Relay" but Active System is Pipeline Orchestrator

**Category**: Documentation Drift
**Files**: `README.md`

**Description**: The top-level README describes "Relay" as a "Slack-first platform where PMs describe a feature, and Relay guides them through Blind QA." It references BRE-181, BRE-182, BRE-183 linear issues and describes an MVP scope focused on `/relay` Slack commands with Jira/Linear sync.

The actual primary system is the autonomous pipeline orchestrator that takes a Linear ticket and produces a fully implemented feature branch. The Slack-based Relay server code exists in `src/` but is secondary to the orchestration system. The `docs/L1-architecture.md` correctly identifies this as "Two Systems in One Repository" but the README does not reflect this.

**Impact**: New contributors, AI agents, or users reading only the README will have a misleading understanding of what the project does. They will expect a Slack bot, not an autonomous development pipeline.

**Remediation**: Rewrite the README to lead with the pipeline orchestrator as the primary system. Move the Relay/Slack description to a "Relay Server (Secondary)" section. Reference `docs/L1-architecture.md` for detailed architecture.

---

### 6. src/README.md Uses Legacy "relay." Command Names

**Category**: Documentation Drift
**Files**: `src/README.md`

**Description**: The source directory README lists commands as `relay.install.md`, `relay.pipeline.md`, `relay.specify.md`, etc. All actual commands use the `collab.` prefix (e.g., `collab.run.md`, `collab.specify.md`). The naming was changed from "relay" to "collab" but this README was not updated.

**Impact**: Developers reading `src/README.md` will search for files that do not exist. Minor confusion but misleading.

**Remediation**: Update all `relay.*` references to `collab.*` in `src/README.md`. Also update `relay.pipeline.md` to `collab.run.md`.

---

## Medium Priority

### 7. BRE-QA.json Test Data Left in State Directory

**Category**: Configuration
**Files**: `.collab/state/pipeline-registry/BRE-QA.json`

**Description**: This file contains synthetic test data: `{"ticket_id":"BRE-QA","nonce":"testnonc","current_step":"clarify","status":"running","agent_pane_id":"%test"}`. The nonce value "testnonc" and agent pane "%test" are clearly synthetic. This is not a real ticket in the pipeline.

The `status-table.sh` script will display this as an active ticket when scanning registries. The `held-release-scan.sh` script will attempt to check this ticket's dependencies.

**Impact**: Pollutes status table output. Could cause spurious errors in held-release scans if the %test pane doesn't exist. Misleading for anyone inspecting the state directory.

**Remediation**: Delete `.collab/state/pipeline-registry/BRE-QA.json`. If test fixtures are needed, they should live in `tests/fixtures/` (which already has proper test data).

---

### 8. Empty Plugin Directories Should Be Removed or Documented

**Category**: Dead Code
**Files**:
- `src/plugins/jira/` (empty)
- `src/plugins/linear/` (empty)

**Description**: Both directories exist but contain zero files. They were created as placeholders for future Jira and Linear ticketing plugins referenced in the README's "Plugin-Based System" architecture. However, no implementation exists and no code references them.

Note: `src/protocol/`, `src/blindqa/`, and `src/state/` directories mentioned in the task do NOT exist -- they were investigated and confirmed absent.

**Impact**: Suggests work-in-progress that isn't actually planned. Takes up directory space.

**Remediation**: Either remove the empty directories or add a README.md stub in each explaining they are future placeholders. Given the project has evolved beyond the Relay MVP, removal is recommended.

---

### 9. Database Schema and Drizzle Config Only Used by Relay Server (Not Orchestrator)

**Category**: Architecture
**Files**:
- `src/db/schema.ts`
- `src/db/index.ts`
- `drizzle.config.ts`
- `drizzle/0000_smart_doctor_doom.sql`

**Description**: The database schema defines 7 tables for the Relay Slack-based spec creation workflow (specs, channels, spec_roles, role_members, questions, answers, sessions). The pipeline orchestrator uses only JSON files in `.collab/state/pipeline-registry/` for state -- it does not use PostgreSQL or Drizzle ORM at all.

The database is only relevant when running the Express server (`src/index.ts`) with Slack integration. The active development focus (autonomous pipeline orchestrator) has no database dependency.

**Impact**: No immediate functional impact, but the database code increases the dependency footprint (pg, drizzle-orm in production deps) for a subsystem that may not be actively used. New contributors may attempt to set up PostgreSQL unnecessarily.

**Remediation**: No action needed if the Relay server is still planned for future use. If it is deprecated, consider extracting it to a separate package or marking it clearly as "Relay Server Only" in the README.

---

### 10. Duplicate Gate Prompt Files

**Category**: Configuration
**Files**:
- `src/config/gates/plan.md` AND `src/config/gates/plan-review-prompt.md`
- `src/config/gates/analyze.md` AND `src/config/gates/analyze-review-prompt.md`

**Description**: Each gate has two prompt files. The `pipeline.json` references `plan.md` and `analyze.md` via the gate definitions. The `*-review-prompt.md` files contain similar but not identical content and are not referenced by any configuration or script.

Verified: `pipeline.json` gates reference `.collab/config/gates/plan.md` and `.collab/config/gates/analyze.md`. No script or config references `plan-review-prompt.md` or `analyze-review-prompt.md`.

**Impact**: Confusion about which prompt is canonical. If someone edits the wrong file, their changes will have no effect.

**Remediation**: Either delete the unreferenced `*-review-prompt.md` files, or merge their unique content into the referenced `plan.md`/`analyze.md` files.

---

### 11. verify-config.json Points to Go Test Command

**Category**: Configuration
**Files**: `.collab/config/verify-config.json`, `src/config/verify-config.json`

**Description**: The verify configuration specifies `"command": "go test ./..."` as the test command. This is only appropriate for the Go attractor module, not for the general case. The Relay server uses `vitest`, the CLI uses `vitest`, and TypeScript orchestrator tests use `bun:test`. When deployed to other repositories via `collab.install.sh`, this command will fail unless the target project uses Go.

**Impact**: The verify phase will run the wrong test command in non-Go projects. The install script copies this as-is during first install (skips if already exists).

**Remediation**: Change the default to a more generic value (e.g., `"command": "npm test"`) or make it empty with a comment indicating it must be configured per-project. Consider validating this at orchestrator startup.

---

### 12. verify-patterns.json is Empty

**Category**: Configuration
**Files**: `.collab/config/verify-patterns.json`, `src/config/verify-patterns.json`

**Description**: Both source and runtime copies contain only `[]` (empty array). The Go attractor's `VerifyHandler` reads this file to match test output patterns. With an empty array, pattern-based test verification is effectively disabled.

**Impact**: The verify handler cannot perform pattern-based output analysis. It falls through to exit-code-only verification, which may miss partial failures.

**Remediation**: Populate with common test output patterns (e.g., `"FAIL"`, `"error"`, `"panic"`) or document that the empty state is intentional and exit-code verification is sufficient.

---

## Low Priority / Improvement Opportunities

### 13. Go Attractor Relationship to Bash Orchestrator Is Unclear

**Category**: Architecture
**Files**: `collab/attractor/` (entire directory)

**Description**: The Go attractor (`collab/attractor/`) is a signal-routing bridge (BRE-216) that processes signals from agent panes, dispatches to handlers, and manages transitions. It reads `pipeline.json` and the pipeline registry -- the same data sources as the Bash orchestrator scripts in `src/scripts/orchestrator/`.

The `docs/L1-architecture.md` may clarify this, but the relationship is not documented at the code level. The attractor appears to be a compiled Go replacement for the Bash+TypeScript orchestrator scripts, designed to run as a persistent process (stdin or named pipe input) rather than being invoked script-by-script.

Both systems coexist: the Bash scripts are used by `collab.run.md` (the orchestrator command), while the Go attractor can run independently as a standalone signal router.

**Impact**: Developers may be confused about which system to extend. Both systems interpret the same `pipeline.json` but have separate handler registrations.

**Remediation**: Add a comment block to `collab/attractor/main.go` explaining its relationship to the Bash orchestrator. Consider adding a section to `architecture.md` clarifying: Bash scripts = invoked by AI orchestrator for individual operations; Go attractor = persistent process for signal monitoring/routing.

---

### 14. CLI Tests Use vitest but Orchestrator Tests Use bun:test

**Category**: Testing
**Files**:
- `cli/tests/` -- uses vitest (configured in `cli/vitest.config.ts`)
- `src/scripts/orchestrator/*.test.ts` -- uses `bun:test`

**Description**: Two different test runners are used in the same repository. The CLI module uses vitest (matching the root `vitest.config.ts`), while the TypeScript orchestrator scripts use `bun:test` directly. The root `package.json` defines `"test": "vitest"` which will not discover `bun:test` files.

Running `npm test` from the root will run vitest, which will not execute the orchestrator TypeScript tests. Those require `bun test src/scripts/orchestrator/` separately.

**Impact**: `npm test` does not run all tests. CI/CD pipelines using the root test command will miss orchestrator test failures.

**Remediation**: Either migrate orchestrator tests to vitest for unified test execution, or add a composite test script that runs both: `"test": "vitest && bun test src/scripts/orchestrator/"`.

---

### 15. No Tests for Relay Server Services or Routes

**Category**: Testing
**Files**:
- `src/services/*.ts` (9 service files, 0 test files)
- `src/routes/*.ts` (3 route files, 0 test files)
- `src/lib/*.ts` (4 lib files, 0 test files)
- `src/plugins/slack/*.ts` (4 plugin files, 0 test files)

**Description**: The Relay Express server has 20 TypeScript source files implementing services, routes, middleware, and Slack integration with zero test files. The CLI module has comprehensive tests (6 contract + 5 unit), and the orchestrator scripts have 5 TypeScript test files. The server is the only subsystem with no test coverage.

**Impact**: Server-side regressions will not be caught. If the Relay server is reactivated for Slack integration, there is no test safety net.

**Remediation**: If the Relay server is still planned for use, add at minimum contract tests for the API routes (`/api/specfactory/*`, `/api/spec/*`). If the server is deprecated, this is low priority.

---

### 16. Spec Metadata Files Reference Non-Existent Worktree Paths

**Category**: Configuration
**Files**:
- `specs/001-attractor-ai-gates/metadata.json` -- `worktree_path: /Users/atlas/Code/projects/worktrees/001-attractor-ai-gates`
- `specs/001-pattern-analyzer/metadata.json` -- `worktree_path: /Users/atlas/Code/projects/worktrees/001-pattern-analyzer`
- `specs/001-pattern-analyzer-cli/metadata.json` -- `worktree_path: /Users/atlas/Code/projects/worktrees/001-pattern-analyzer-cli`
- `specs/001-pipeline-v3-schema/metadata.json` -- `worktree_path: /Users/atlas/Code/projects/worktrees/001-pipeline-v3-schema`

**Description**: These metadata files record worktree paths from previous feature development runs. The worktrees may no longer exist on disk (they are temporary working directories). The metadata files persist in the specs directory as historical records.

**Impact**: Minimal. The `orchestrator-init.sh` reads metadata for active tickets only. Stale metadata from completed features is harmless.

**Remediation**: No action needed. These are historical records. The `/collab.cleanup` command should handle removal when features are completed.

---

### 17. Specs Directory is .gitignored but Contains Checked-in Files

**Category**: Configuration
**Files**: `.gitignore` (line 47: `specs/`), `specs/` directory (contains 22+ files)

**Description**: The `.gitignore` file includes `specs/` which would prevent new spec files from being tracked. However, the existing specs directory with all its files IS tracked in git (they were committed before the gitignore rule was added, or the rule was added afterward). This creates an inconsistency: existing spec files are versioned, but new ones would be silently ignored.

**Impact**: New feature specs created by `/collab.specify` will not appear in `git status` and could be lost. Developers may not realize their spec work is untracked.

**Remediation**: Either remove `specs/` from `.gitignore` (if specs should be version-controlled) or archive/remove the existing tracked specs and keep the gitignore rule (if specs are meant to be local-only). Given that specs contain valuable design documentation, version-controlling them is recommended.
