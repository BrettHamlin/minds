---
description: Generate Mind-aware tasks for collab development. Decomposes work along Mind boundaries — each task stays within one Mind's domain. Cross-Mind work becomes separate tasks with interface contracts.
---

> **IMPORTANT:** Execute these steps directly and sequentially. Do NOT wrap this workflow in PAI Algorithm phases, ISC criteria, capability selection, or any other meta-framework. Follow the numbered steps exactly as written.

> **NEVER ask interactive questions.** Do NOT present menus, multiple-choice options, or ask the user to choose an approach. If prior work exists for the ticket (commits, partial implementations), analyze the current state yourself and generate tasks for what remains. If no spec/plan exists, fetch the ticket from Linear and generate tasks directly. Always proceed autonomously.

## Path Detection

Determine the Minds source directory before running any commands. In the dev repo (has `minds/cli/`), use `minds/`. In installed repos, use `.minds/`.

```bash
if [ -d "minds/cli" ]; then MINDS_DIR="minds"; else MINDS_DIR=".minds"; fi
```

Use `{MINDS_DIR}` for all script paths below. The registry lives at `{MINDS_DIR}/minds.json`.

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

This command generates tasks for developing the **collab repo itself**, where work is distributed across Minds. Unlike `collab.tasks.md` (which generates tasks for target repos), this command is Mind-aware: every task is scoped to exactly one Mind's domain.

## Outline

1. **Load Mind registry**: Read `{MINDS_DIR}/minds.json` from the repo root (pre-populated by the installer; in the dev repo, generate with `bun {MINDS_DIR}/generate-registry.ts` if missing). Parse the JSON array of MindDescription objects. Each Mind has:
   - `name` — the Mind's identifier (e.g., `signals`, `pipeline_core`)
   - `domain` — what this Mind is responsible for
   - `owns_files` — directories/files this Mind owns exclusively
   - `capabilities` — what this Mind can do
   - `exposes` — public interfaces offered to other Minds
   - `consumes` — dependencies on other Minds' interfaces

   If `{MINDS_DIR}/minds.json` does not exist, run `bun {MINDS_DIR}/generate-registry.ts` first to create it, then read it.

2. **Load design documents**: Read from the feature directory (run `bun {MINDS_DIR}/execution/resolve-feature.ts` if needed):
   - **Required**: plan.md (tech stack, structure), spec.md (user stories, AC)
   - **Optional**: data-model.md, contracts/, research.md, quickstart.md

3. **Identify involved Minds**: Before generating any tasks, scan the plan and spec to determine which files/directories will be touched. Match each file path against Mind `owns_files` to identify which Minds are involved in this work. If a file path falls outside all existing minds' ownership, propose a new Mind for that domain and declare its boundary with `owns:` in the section header (see "Ownership Annotation for New Minds" below).

4. **Generate tasks PER MIND** (CRITICAL):

   For each involved Mind, generate tasks that stay entirely within that Mind's `owns_files` boundary. Follow these rules:

   - **One Mind per task**: A task MUST NOT touch files owned by two different Minds. If you find yourself writing a task that spans boundaries, split it.
   - **Interface contracts for cross-Mind work**: When Mind A produces something that Mind B consumes:
     - Mind A's task: "Create/update X — produces: `export type Foo` at `{MINDS_DIR}/pipeline_core/types.ts`"
     - Mind B's task: "Import and use Foo — consumes: `import { Foo } from '../pipeline_core/types'`"
     - Mind B's task depends on Mind A's task
   - **Use `exposes`/`consumes` from minds.json**: These tell you the existing interfaces between Minds. New cross-Mind work should follow the same patterns.
   - **Think of each Mind as an independent team**: They work in parallel on their own tasks, coordinating only through contracts.

5. **Task format**: Each task follows this format:

   ```
   - [ ] T001 @mind_name [P] Description with exact file path
   ```

   - `@mind_name` is REQUIRED on every task (e.g., `@signals`, `@pipeline_core`, `@execution`)
   - `[P]` marks parallelizable tasks (different Minds can always run in parallel)
   - Tasks within the same Mind are sequential unless marked `[P]`
   - Include exact file paths in descriptions

6. **Organize by Mind, not by user story**: The primary grouping is by Mind, not by feature phase.

   ```markdown
   ## @pipeline_core Tasks
   - [ ] T001 @pipeline_core Add LoadedPipeline type to {MINDS_DIR}/pipeline_core/types.ts
   - [ ] T002 @pipeline_core [P] Update loadPipelineForTicket in {MINDS_DIR}/pipeline_core/utils.ts

   ## @signals Tasks
   - [ ] T003 @signals [P] Add signal resolver in {MINDS_DIR}/signals/resolve-signal.ts
   - [ ] T004 @signals Update emit handler — consumes: pipeline_core/LoadedPipeline

   ## @execution Tasks (depends on: @pipeline_core, @signals)
   - [ ] T005 @execution Update phase-dispatch — consumes: signals/resolveSignalName, pipeline_core/loadPipelineForTicket

   ## @cors_middleware Tasks (owns: src/middleware/cors/**, depends on: @pipeline_core)
   - [ ] T006 @cors_middleware Create CORS handler at src/middleware/cors/handler.ts
   - [ ] T007 @cors_middleware [P] Add config loader — consumes: loadPipelineForTicket from {MINDS_DIR}/pipeline_core/utils.ts

   ## Cross-Mind Contracts
   | Producer | Interface | Consumer |
   |----------|-----------|----------|
   | @pipeline_core | LoadedPipeline type | @execution, @signals |
   | @signals | resolveSignalName() | @execution |
   ```

7. **Write tasks.md**: Write the file to the feature directory.

   **CRITICAL — feature directory naming**: The feature directory MUST be named `specs/{TICKET_ID}/` using the exact ticket ID (e.g., `specs/BRE-432/`). Do NOT use slugified descriptions (e.g., `specs/432-run-duration-metric/` is WRONG). If the directory does not exist, create it:

   ```bash
   mkdir -p specs/{TICKET_ID}
   ```

   Then write the file to `specs/{TICKET_ID}/tasks.md`.

8. **Lint and fix** (MANDATORY — do not skip): After writing tasks.md, run the linter and fix any errors before reporting.

   ```bash
   bun {MINDS_DIR}/cli/bin/minds.ts lint specs/{TICKET_ID}/tasks.md --json
   ```

   The linter outputs `{ valid, errors, warnings }`. If `valid` is false:

   - Read each error's `type`, `task`, and `message`
   - Fix the failing tasks directly in tasks.md:
     - **boundary_violation**: The task references a file outside the Mind's `owns_files`. Either reassign the task to the correct Mind, or if it's a new Mind, add `owns: <path>` to the section header.
     - **unregistered_mind**: The Mind doesn't exist in `minds.json` and no `owns:` was declared in the section header. Add `owns: <path>` to the section header.
     - **missing_deps_header**: A task has `consumes:` but the section header lacks `(depends on: ...)`. Add the dependency.
   - Re-run the linter. Repeat until `valid` is true (max 3 attempts).
   - If still failing after 3 attempts, output the errors and stop — do not run implement.

   Warnings (e.g. `dangling_consume`) are informational — don't block on them.

9. **Report**: Output summary:
   - Total task count
   - Tasks per Mind
   - Cross-Mind contracts identified
   - Parallel opportunities (Minds that can work simultaneously)
   - Dependency order between Minds

## Task Generation Rules

### Per-Mind Scoping (MANDATORY)

Before writing any task, check: does this task's file path fall within exactly one Mind's `owns_files`? If not, split it.

Common splits:
- "Update types and update handler" → Split: types task (@pipeline_core) + handler task (@execution)
- "Add signal emission to phase dispatch" → Split: signal utility (@signals) + dispatch integration (@execution)
- "Create shared utility and use it" → Split: utility creation (owning Mind) + usage (consuming Mind)

### Contract Format

When tasks cross Mind boundaries, add explicit contract notes:

```
- [ ] T003 @pipeline_core Add resolveVariant() — produces: export at {MINDS_DIR}/pipeline_core/utils.ts
- [ ] T007 @execution Use resolveVariant in phase-advance — consumes: pipeline_core/resolveVariant
```

### Annotation Format (parsed by deterministic linter)

Task descriptions use inline annotations that the contract linter (`{MINDS_DIR}/lib/contracts.ts`) parses deterministically:

**Produces** — this task creates an interface for other Minds:
```
- [ ] T001 @pipeline_core Add resolveVariant() — produces: resolveVariant() at {MINDS_DIR}/pipeline_core/utils.ts
```

**Consumes** — this task uses an interface from another Mind's domain:
```
- [ ] T005 @execution Use resolveVariant in phase-advance — consumes: resolveVariant() from {MINDS_DIR}/pipeline_core/utils.ts
```

Rules:
- `produces:` must include the interface name and the file path where it's exported
- `consumes:` must include the interface name and the import path (the path, not the Mind name)
- Do NOT reference other Minds by name in task descriptions — only the import path is allowed
- The contract linter validates all annotations before dispatch begins

### Tests Stay With Implementation (MANDATORY)

When a task involves modifying or creating source code, the corresponding tests MUST be part of the SAME Mind's tasks — even if the test files are in a directory nominally owned by a different Mind (e.g., `tests/`, `__tests__/`, `*.test.ts`).

**Why:** If you split "implement feature" into `@blueprint-api` and "test feature" into `@server-core`, the test mind can't run until the implementation mind finishes, AND the test mind will try to modify test files that may be outside its boundary. This causes wave ordering failures and boundary violations.

**Rules:**
- If a task creates/modifies `src/api/foo.ts`, the task to test it (`tests/api/foo.test.ts`) goes to the SAME mind
- The implementing Mind's `owns_files` boundary is temporarily expanded to include test files for code it implements — add these paths to the task descriptions
- Do NOT create a separate "test mind" or assign test-writing tasks to `@server-core` or similar infrastructure minds unless the tests are purely for pre-existing code unrelated to any other mind's implementation work
- If a Mind writes code, it writes the tests for that code. Period.

**Example:**
```
## @blueprint-api Tasks
- [ ] T001 @blueprint-api Refactor JSON response types in packages/modules/blueprint/api.ts
- [ ] T002 @blueprint-api Update tests for JSON responses in tests/modules/blueprint/api.test.ts
```

NOT:
```
## @blueprint-api Tasks
- [ ] T001 @blueprint-api Refactor JSON response types in packages/modules/blueprint/api.ts

## @server-core Tasks (depends on: @blueprint-api)
- [ ] T002 @server-core Update tests for JSON responses in tests/modules/blueprint/api.test.ts
```

### Anti-Leakage (MANDATORY)

Each Mind's tasks must be self-contained. A task description must NEVER:
- Reference another Mind by name (e.g., "after @signals creates..." — WRONG)
- Describe what another Mind is doing or will do
- Include details about another Mind's internal implementation

The ONLY external reference allowed is the import path in a `consumes:` annotation. The drone does not need to know who produces the interface — only where to import it from.

### Ownership Annotation for New Minds (`owns:`)

When a feature requires a Mind that does NOT exist in `minds.json`, declare its file ownership in the section header using `owns:`. This tells the system what files the new Mind is responsible for, enabling auto-scaffolding and boundary enforcement.

**Format** — add `owns:` to the section header (combinable with `depends on:`):
```
## @new_mind Tasks (owns: src/api/**, src/models/**)
## @new_mind Tasks (owns: src/middleware/cors/**, depends on: @pipeline_core)
```

**When to add `owns:`**:
- The mind does NOT exist in `minds.json` yet
- You are introducing a new domain that needs its own boundary

**When NOT to add `owns:`**:
- The mind already exists in `minds.json` — it already has `owns_files`
- Adding `owns:` to an existing mind with different paths causes a lint error

**Glob rules**:
- Use `**` suffix for directory trees: `src/middleware/cors/**`
- Must be specific — bare `**` or `src/` will be rejected by the linter
- Must not contain `..` (path traversal is rejected)
- Must not overlap with another mind's `owns_files` (pairwise check)

### Dependencies

- Tasks within the same Mind: sequential by default, `[P]` if independent
- Tasks across different Minds: parallel by default, dependent only if consuming another Mind's output
- Always list Mind-level dependencies in section headers: `## @execution Tasks (depends on: @pipeline_core)`
