---
context:
  SPEC_MD: "specs/${TICKET_ID}/spec.md"
  TASKS_MD: "specs/${TICKET_ID}/tasks.md"
  ANALYSIS_MD: "specs/${TICKET_ID}/analysis.md"
---
# Analyze Review Gate

## Analysis Report
${ANALYSIS_MD}

## Tasks
${TASKS_MD}

## Specification
${SPEC_MD}

**CRITICAL**: Your verdict must be based solely on the Analysis Report above. Do NOT substitute your own independent artifact review if the report is absent or incomplete — that bypasses the analyze phase entirely.

**Rules**:
- If `ANALYSIS_MD` is missing or contains no findings table: respond `ESCALATION` with instruction to re-run `/gravitas.analyze` so a proper report exists.
- If findings exist and have NOT been applied to the artifacts: respond `ESCALATION` with the specific findings from the report as concrete file-by-file remediation instructions (one per finding row).
- If findings exist and ALL have been resolved in the current artifacts: respond `REMEDIATION_COMPLETE`.
- If the report explicitly states zero findings: respond `REMEDIATION_COMPLETE`.

When emitting `ESCALATION`, relay the exact findings as actionable instructions:
"Apply the following to the specified files before re-running `.gravitas/scripts/verify-and-complete.sh analyze 'Analysis phase finished'`:
[finding ID] [file] — [exact correction]"

Respond with one of:
- `REMEDIATION_COMPLETE`
- `ESCALATION: <specific finding-by-finding instructions from the analysis report>`
