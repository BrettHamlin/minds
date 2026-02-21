---
context:
  SPEC_MD: "specs/{{TICKET_ID}}/spec.md"
  TASKS_MD: "specs/{{TICKET_ID}}/tasks.md"
---
# Analyze Review Gate — {{PHASE}}

You are reviewing the analysis findings for this feature.

## Tasks
{{TASKS_MD}}

## Specification
{{SPEC_MD}}

**Phase 1**: Apply all analysis findings to the appropriate artifact files (spec.md, plan.md, tasks.md).
**Phase 2 (escalation)**: Confirm all prior findings have been resolved. Escalate any unresolved gaps.

Respond with one of:
- `REMEDIATION_COMPLETE` — all findings have been applied
- `ESCALATION: <unresolved issues>` — issues remain that need human review
