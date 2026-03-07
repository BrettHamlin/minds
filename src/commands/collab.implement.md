---
description: Execute the implementation plan by processing and executing all tasks defined in tasks.md
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Orchestrator Signal Contract (ALWAYS ACTIVE)

> **This applies throughout your entire execution — not just at the end.**

You are operating in an orchestrated pipeline. The orchestrator waits for your signal to advance. Whenever you have **finished all work for this phase and all tests pass**, run:

```bash
bun .collab/scripts/verify-and-complete.ts implement "Implementation phase finished"
```

This verification script will check that all tasks are complete and automatically emit the signal.

This applies in **every scenario**:
- Normal completion of the outline steps below ✓
- After fixing issues flagged by the orchestrator (⛔ NO EXCUSES) ✓
- After any follow-up work or test reruns ✓

You do not need to wait for step 10. Any time your response represents "this phase is done and working", run the verification script to emit the signal.

---

## Outline

1. Run `bun .collab/scripts/resolve-feature.ts --require-tasks --include-tasks` from repo root and parse FEATURE_DIR and AVAILABLE_DOCS list.

1b. **Parse Phase Scope** (if `$ARGUMENTS` contains `phase:N` or `phase:N-M`):
   - `phase:3` → execute only Phase 3 from tasks.md
   - `phase:1-4` → execute Phases 1 through 4 from tasks.md
   - No phase argument → execute ALL phases (default, backwards compatible)
   - Phase numbers correspond to the `## Phase N:` headers in tasks.md
   - Store the phase scope; it constrains steps 5 and 6 (task filtering and execution)
   - **Note**: Do NOT pass the scope to the verify script in step 10 — it auto-detects from the registry

1c. **Parse Mind Scope** (if `$ARGUMENTS` contains `mind:<name>`):
   - `mind:signals` → execute only tasks tagged `@signals` in tasks.md
   - `mind:pipeline_core` → execute only tasks tagged `@pipeline_core`
   - No mind argument → execute ALL tasks regardless of `@mind` tag (default, backwards compatible)
   - Store the mind scope; it constrains step 5 (task filtering) alongside phase scope
   - Mind scope and phase scope can combine: `phase:3 mind:signals` → only @signals tasks in Phase 3

1d. **Load Mind Registry** (if `.collab/minds.json` exists at repo root):
   - Read and parse the JSON to get the list of Minds with their `name`, `domain`, `owns_files`, `exposes`, and `consumes`
   - If `minds.json` does not exist, skip (backward compatible — all tasks execute normally)
   - If mind scope is active from step 1c, verify the named Mind exists in the registry. If not found, warn and fall back to executing all tasks.
   - Use the registry to understand cross-Mind contracts: when a task's `@mind` tag differs from the current mind scope, that task belongs to another Mind and should be skipped (but its outputs may be consumed)

1e. **Load Phase Structure** (deterministic — do this before step 5):

   Where `{ticket_id}` is extracted from `$ARGUMENTS` or the current branch name.

   ```bash
   PHASE_DATA=$(bun .collab/scripts/analyze-task-phases.ts {ticket_id})
   ```

   Parse JSON to get `totalPhases`, `phases[]`, and `nextIncompletePhase`.
   - Use `totalPhases` to understand the overall scope
   - If no phase scope from step 1b, use `nextIncompletePhase` to determine which phase to resume
   - Each phase entry provides `number`, `title`, `total`, `complete`, `incomplete` counts without LLM parsing

2. **Check checklists status** (if FEATURE_DIR/checklists/ exists):
   - Scan all checklist files in the checklists/ directory
   - For each checklist, count:
     - Total items: All lines matching `- [ ]` or `- [X]` or `- [x]`
     - Completed items: Lines matching `- [X]` or `- [x]`
     - Incomplete items: Lines matching `- [ ]`
   - Create a status table:

     ```text
     | Checklist | Total | Completed | Incomplete | Status |
     |-----------|-------|-----------|------------|--------|
     | ux.md     | 12    | 12        | 0          | ✓ PASS |
     | test.md   | 8     | 5         | 3          | ✗ FAIL |
     | security.md | 6   | 6         | 0          | ✓ PASS |
     ```

   - Calculate overall status:
     - **PASS**: All checklists have 0 incomplete items
     - **FAIL**: One or more checklists have incomplete items

   - **If any checklist is incomplete**:
     - Display the table with incomplete item counts
     - **STOP** and ask: "Some checklists are incomplete. Do you want to proceed with implementation anyway? (yes/no)"
     - Wait for user response before continuing
     - If user says "no" or "wait" or "stop", halt execution
     - If user says "yes" or "proceed" or "continue", proceed to step 3

   - **If all checklists are complete**:
     - Display the table showing all checklists passed
     - Automatically proceed to step 3

3. Load and analyze the implementation context:
   - **REQUIRED**: Read tasks.md for the complete task list and execution plan
   - **REQUIRED**: Read plan.md for tech stack, architecture, and file structure
   - **IF EXISTS**: Read data-model.md for entities and relationships
   - **IF EXISTS**: Read contracts/ for API specifications and test requirements
   - **IF EXISTS**: Read research.md for technical decisions and constraints
   - **IF EXISTS**: Read quickstart.md for integration scenarios

4. **Project Setup Verification**:
   - **REQUIRED**: Create/verify ignore files based on actual project setup:

   **Detection & Creation Logic**:
   - Check if the following command succeeds to determine if the repository is a git repo (create/verify .gitignore if so):

     ```sh
     git rev-parse --git-dir 2>/dev/null
     ```

   - Check if Dockerfile* exists or Docker in plan.md → create/verify .dockerignore
   - Check if .eslintrc* exists → create/verify .eslintignore
   - Check if eslint.config.* exists → ensure the config's `ignores` entries cover required patterns
   - Check if .prettierrc* exists → create/verify .prettierignore
   - Check if .npmrc or package.json exists → create/verify .npmignore (if publishing)
   - Check if terraform files (*.tf) exist → create/verify .terraformignore
   - Check if .helmignore needed (helm charts present) → create/verify .helmignore

   **If ignore file already exists**: Verify it contains essential patterns, append missing critical patterns only
   **If ignore file missing**: Create with full pattern set for detected technology

   **Common Patterns by Technology** (from plan.md tech stack):
   - **Node.js/JavaScript/TypeScript**: `node_modules/`, `dist/`, `build/`, `*.log`, `.env*`
   - **Python**: `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `dist/`, `*.egg-info/`
   - **Java**: `target/`, `*.class`, `*.jar`, `.gradle/`, `build/`
   - **C#/.NET**: `bin/`, `obj/`, `*.user`, `*.suo`, `packages/`
   - **Go**: `*.exe`, `*.test`, `vendor/`, `*.out`
   - **Ruby**: `.bundle/`, `log/`, `tmp/`, `*.gem`, `vendor/bundle/`
   - **PHP**: `vendor/`, `*.log`, `*.cache`, `*.env`
   - **Rust**: `target/`, `debug/`, `release/`, `*.rs.bk`, `*.rlib`, `*.prof*`, `.idea/`, `*.log`, `.env*`
   - **Kotlin**: `build/`, `out/`, `.gradle/`, `.idea/`, `*.class`, `*.jar`, `*.iml`, `*.log`, `.env*`
   - **C++**: `build/`, `bin/`, `obj/`, `out/`, `*.o`, `*.so`, `*.a`, `*.exe`, `*.dll`, `.idea/`, `*.log`, `.env*`
   - **C**: `build/`, `bin/`, `obj/`, `out/`, `*.o`, `*.a`, `*.so`, `*.exe`, `Makefile`, `config.log`, `.idea/`, `*.log`, `.env*`
   - **Swift**: `.build/`, `DerivedData/`, `*.swiftpm/`, `Packages/`
   - **R**: `.Rproj.user/`, `.Rhistory`, `.RData`, `.Ruserdata`, `*.Rproj`, `packrat/`, `renv/`
   - **Universal**: `.DS_Store`, `Thumbs.db`, `*.tmp`, `*.swp`, `.vscode/`, `.idea/`

   **Tool-Specific Patterns**:
   - **Docker**: `node_modules/`, `.git/`, `Dockerfile*`, `.dockerignore`, `*.log*`, `.env*`, `coverage/`
   - **ESLint**: `node_modules/`, `dist/`, `build/`, `coverage/`, `*.min.js`
   - **Prettier**: `node_modules/`, `dist/`, `build/`, `coverage/`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
   - **Terraform**: `.terraform/`, `*.tfstate*`, `*.tfvars`, `.terraform.lock.hcl`
   - **Kubernetes/k8s**: `*.secret.yaml`, `secrets/`, `.kube/`, `kubeconfig*`, `*.key`, `*.crt`

5. Parse tasks.md structure and extract:
   - **Task phases**: Setup, Tests, Core, Integration, Polish
   - **Task dependencies**: Sequential vs parallel execution rules
   - **Task details**: ID, description, file paths, parallel markers [P], `@mind` assignments, `[US#]` story labels
   - **Execution flow**: Order and dependency requirements
   - **If phase scope is active**: Filter the task list to include ONLY tasks from the specified phase(s). Skip all other phases entirely.
   - **If mind scope is active**: Filter the task list to include ONLY tasks tagged with the specified `@mind`. Tasks without any `@mind` tag (e.g., setup/foundational tasks) are always included regardless of mind scope.
   - **Contract awareness**: For tasks with `produces:` or `consumes:` annotations, note the inter-Mind interfaces. When executing a task that `consumes:` from another Mind, verify the consumed interface exists before proceeding.

6. Execute implementation following the task plan:
   - **Phase-by-phase execution**: Complete each phase before moving to the next
   - **Respect dependencies**: Run sequential tasks in order, parallel tasks [P] can run together
   - **Follow TDD approach**: Execute test tasks before their corresponding implementation tasks
   - **File-based coordination**: Tasks affecting the same files must run sequentially
   - **Mind boundary enforcement**: Only modify files within the current Mind's `owns_files` paths (from minds.json). If a task requires changes outside the Mind's boundary, flag it rather than proceeding.
   - **Validation checkpoints**: Verify each phase completion before proceeding

7. Implementation execution rules:
   - **Setup first**: Initialize project structure, dependencies, configuration
   - **Tests before code**: If you need to write tests for contracts, entities, and integration scenarios
   - **Core development**: Implement models, services, CLI commands, endpoints
   - **Integration work**: Database connections, middleware, logging, external services
   - **Polish and validation**: Unit tests, performance optimization, documentation

8. Progress tracking and error handling:
   - Report progress after each completed task
   - Halt execution if any non-parallel task fails
   - For parallel tasks [P], continue with successful tasks, report failed ones
   - Provide clear error messages with context for debugging
   - Suggest next steps if implementation cannot proceed
   - **IMPORTANT** For completed tasks, make sure to mark the task off as [X] in the tasks file.

9. Completion validation:
   - Verify all required tasks are completed
   - Check that implemented features match the original specification
   - Validate that tests pass and coverage meets requirements
   - Confirm the implementation follows the technical plan
   - Report final status with summary of completed work

10. **Verify Completion and Emit Signal**

    Run the verification script to confirm tasks are complete and automatically emit the completion signal:

    ```bash
    bun .collab/scripts/verify-and-complete.ts implement "Implementation phase finished"
    ```

    This script will:
    - Auto-detect the current phase scope from the registry (when running in an orchestrated pipeline)
    - Verify tasks in the scoped phase are marked complete [X] (or all tasks if no scope)
    - Automatically emit the IMPLEMENT_COMPLETE signal to the orchestrator
    - Exit with error if any scoped tasks remain incomplete

    **CRITICAL**: This step is MANDATORY for orchestrated workflows. Without it, the orchestrator will wait indefinitely.

    **If the orchestrator sends a rejection (⛔ NO EXCUSES):** Fix all identified issues, re-run the full test suite to confirm 0 failures, then run the verification script again to re-emit the signal. Do NOT consider the task done until you have successfully run the verification script after fixing.

Note: This command assumes a complete task breakdown exists in tasks.md. If tasks are incomplete or missing, suggest running `/collab.tasks` first to regenerate the task list.
