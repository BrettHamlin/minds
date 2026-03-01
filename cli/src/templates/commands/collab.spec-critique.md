---
description: Orchestrator-compatible spec validation with deterministic signal emission and iterative loop
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-191)

## Goal

Execute adversarial specification analysis to find gaps, ambiguities, and missing details BEFORE implementation. Emit deterministic signals to orchestrator for pipeline integration. Loop until zero HIGH severity issues remain.

## Execution Steps

### 1. Validate Input

Parse arguments to extract:
- `ticket_id` (required)

If no ticket ID provided, error and exit.

### 2. Verify Registry State (Optional - for orchestrated mode)

Check if orchestrated mode is active:
```bash
if [ -f .collab/state/pipeline-registry/${ticket_id}.json ]; then
  # Verify current_step if in orchestrated mode
  cat .collab/state/pipeline-registry/${ticket_id}.json | grep '"current_step".*"spec-critique"' || { echo "Warning: not in spec-critique phase"; }
fi
```

### 3. Emit SPEC_CRITIQUE_START Signal

Run:
```bash
bun .collab/handlers/emit-spec-critique-signal.ts start "Starting spec analysis for ${ticket_id}"
```

This is MANDATORY before invoking SpecCritique skill. The signal must be sent before analysis begins so orchestrator can track progress.

### 4. Invoke SpecCritique Skill

Use the Skill tool to invoke SpecCritique:

```
Skill: SpecCritique
Args: ${ticket_id}

This will invoke the Critique workflow which will:
1. Fetch Linear ticket
2. Analyze spec for gaps across all categories
3. Identify HIGH/MEDIUM/LOW severity issues
4. Ask clarifying questions via AskUserQuestion for HIGH issues
5. Update spec with answers
6. Re-analyze until zero HIGH issues remain
7. Return final report
```

### 5. Evaluate Result

Parse SpecCritique output for verdict:

**Case A: HARDENED (zero HIGH issues)**
- All HIGH severity issues resolved
- Emit success signal:
  ```bash
  bun .collab/handlers/emit-spec-critique-signal.ts pass "Spec hardened - ${issue_count} issues resolved"
  ```
- Exit successfully

**Case B: BLOCKED (HIGH issues remain after max iterations)**
- HIGH severity issues still present after iteration limit
- Emit failure signal:
  ```bash
  bun .collab/handlers/emit-spec-critique-signal.ts fail "${high_issue_count} HIGH issues remain after max iterations"
  ```
- Report issues and exit (cannot proceed to planning)

**Case C: WARNING (only MEDIUM/LOW issues)**
- No HIGH issues, but MEDIUM or LOW issues present
- Emit warning signal:
  ```bash
  bun .collab/handlers/emit-spec-critique-signal.ts warn "Spec usable but has ${medium_issue_count} MEDIUM, ${low_issue_count} LOW issues"
  ```
- Exit successfully (can proceed to planning)

### 6. Exit Strategy

**Success Path:**
- Emit SPEC_CRITIQUE_PASS signal
- Output: "✅ Spec analysis PASSED - all HIGH issues resolved"
- Exit code 0

**Warning Path:**
- Emit SPEC_CRITIQUE_WARN signal
- Output: "⚠️ Spec analysis PASSED with warnings - MEDIUM/LOW issues remain"
- Exit code 0

**Failure Path:**
- Emit SPEC_CRITIQUE_FAIL signal
- Output: "❌ Spec analysis FAILED - HIGH issues remain after max iterations"
- List unresolved HIGH issues
- Exit code 1

**Error Path:**
- Emit SPEC_CRITIQUE_ERROR signal if unexpected error occurs
- Output error details
- Exit code 1

## Signal Protocol Summary

1. **SPEC_CRITIQUE_START** - Sent at beginning of analysis
2. **SPEC_CRITIQUE_PASS** - Sent when all HIGH issues resolved
3. **SPEC_CRITIQUE_WARN** - Sent when only MEDIUM/LOW issues remain
4. **SPEC_CRITIQUE_FAIL** - Sent when HIGH issues remain after max iterations

**Orchestrator Integration:**
- Orchestrator waits for SPEC_CRITIQUE_PASS or SPEC_CRITIQUE_WARN or SPEC_CRITIQUE_FAIL signal
- On PASS/WARN: Advance to next phase (planning)
- On FAIL: Halt pipeline, require manual intervention

## Example Invocations

**Standard mode:**
```
collab.spec-critique BRE-191
```

## Design Rationale

This command follows the proven `collab.blindqa` pattern:
- **Deterministic signals** via explicit echo/bun calls (not hooks)
- **Orchestration boundary** separated from skill logic
- **SpecCritique skill stays clean** for standalone use
- **Iterative loop** built into skill (not in command wrapper)
- **Signal contract** documented and versioned independently

Implements adapter pattern separating infrastructure (signaling) from domain (spec analysis).
