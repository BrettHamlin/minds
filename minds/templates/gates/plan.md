---
context:
  SPEC_MD: "specs/${TICKET_ID}/spec.md"
  PLAN_MD: "specs/${TICKET_ID}/plan.md"
---
# Plan Review Gate — ${PHASE}

You are reviewing the implementation plan for ticket **${TICKET_ID}**.

## Feature Specification
${SPEC_MD}

## Implementation Plan
${PLAN_MD}

## Data Model
${DATA_MODEL_MD}

## Research Decisions
${RESEARCH_MD}

## Your Task

Evaluate the plan against these criteria:

1. **Requirements Coverage**: Does the plan address all functional requirements in spec.md?
2. **Data Model Completeness**: Are all entities and relationships defined in data-model.md?
3. **Phase Ordering**: Are dependencies between phases correctly ordered?
4. **Acceptance Criteria**: Do the success criteria in spec.md align with the plan?
5. **Constitution Compliance**: Does the plan comply with .gravitas/memory/constitution.md?

## Response Format

Respond with **ONE** of these keywords:

- `APPROVED` — plan is ready for implementation
- `REVISION_NEEDED: <specific issues to address>` — plan needs revision before proceeding. Your feedback will be sent back to the agent to fix.
