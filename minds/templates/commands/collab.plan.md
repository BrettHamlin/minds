---
description: Execute the implementation planning workflow using the plan template to generate design artifacts.
handoffs: 
  - label: Create Tasks
    agent: relay.tasks
    prompt: Break the plan into tasks
    send: true
  - label: Create Checklist
    agent: relay.checklist
    prompt: Create a checklist for the following domain...
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Orchestrator Signal Contract (ALWAYS ACTIVE)

> **This applies throughout your entire execution — not just at the end.**

Whenever you have **finished all planning work for this phase**, emit:

```bash
bun .collab/handlers/emit-question-signal.ts complete "Plan phase finished"
```

This applies in every scenario: normal completion, after follow-up messages from the orchestrator, after any retry. Any response that represents "this phase is done" must end with this signal.

---

## Outline

1. **Setup**: Run `bun .collab/scripts/resolve-feature.ts --setup-plan` from repo root and parse JSON for FEATURE_SPEC, IMPL_PLAN, SPECS_DIR (= FEATURE_DIR), BRANCH.

2. **Load context**: Read FEATURE_SPEC and `.collab/memory/constitution.md`. Load IMPL_PLAN template (already copied).

3. **Execute plan workflow**: Follow the structure in IMPL_PLAN template to:
   - Fill Technical Context (mark unknowns as "NEEDS CLARIFICATION")
   - Fill Constitution Check section from constitution
   - Evaluate gates (ERROR if violations unjustified)
   - Phase 0: Generate research.md (resolve all NEEDS CLARIFICATION)
   - Phase 1: Generate data-model.md, contracts/, quickstart.md
   - Phase 1: Update agent context by running the agent script
   - Re-evaluate Constitution Check post-design

4. **Emit Completion Signal**
   ```bash
   bun .collab/handlers/emit-question-signal.ts complete "Plan phase finished"
   ```
   **CRITICAL**: This signal emission is MANDATORY for orchestrated workflows. Without it, the orchestrator will wait indefinitely.

5. **Stop and report**: Command ends after Phase 2 planning. Report branch, IMPL_PLAN path, and generated artifacts.

## Phases

### Phase 0: Outline & Research

1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:

   ```text
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

### Phase 1: Design & Contracts

**Prerequisites:** `research.md` complete

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Agent context update**:
   - Skip agent context update (handled by pipeline orchestrator)

**Output**: data-model.md, /contracts/*, quickstart.md, agent-specific file

## Key rules

- Use absolute paths
- ERROR on gate failures or unresolved clarifications
