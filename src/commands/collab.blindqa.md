---
description: Orchestrator-compatible blind verification with deterministic signal emission and retry loop
---

## User Input

```text
$ARGUMENTS
```

Expected format: `<ticket-id>` (e.g., BRE-191)

Optional flags:
- `--interactive`: Enable guided issue resolution (default: batch report mode)

## Goal

Execute blind adversarial verification of completed implementation with zero implementation context. Emit deterministic signals to orchestrator for pipeline integration. Retry on failure up to 3 attempts.

## Execution Steps

### 1. Validate Input

Parse arguments to extract:
- `ticket_id` (required)
- `--interactive` flag (optional)

If no ticket ID provided, error and exit.

### 2. Verify Registry State

Check that orchestrated mode is active:
```bash
test -f .collab/state/pipeline-registry/${ticket_id}.json || { echo "Not in orchestrated mode"; exit 1; }
```

Verify current_step is "blindqa":
```bash
cat .collab/state/pipeline-registry/${ticket_id}.json | grep '"current_step".*"blindqa"' || { echo "Warning: not in blindqa phase"; }
```

### 3. Initialize Retry Loop

Set retry count: `attempt = 1`, `max_attempts = 3`

### 4. Emit BLINDQA_START Signal (First Attempt Only)

On first attempt only, run:
```bash
bun .collab/handlers/emit-blindqa-signal.ts start "Starting blind verification (attempt ${attempt}/${max_attempts})"
```

This is MANDATORY before invoking BlindQA skill. The signal must be sent before verification begins so orchestrator can track progress.

### 5. Invoke BlindQA Skill

Use the Skill tool to invoke BlindQA:

```
Skill: BlindQA
Args: ${ticket_id}

This will invoke the BlindVerify workflow which will:
1. Execute adversarial verification with zero implementation context
2. Report PASS or FAIL with evidence for each check
3. Return verification results
```

**If --interactive flag present:**
```
Skill: BlindQA
Args: ${ticket_id} --interactive

This will invoke the BlindVerify workflow in interactive mode which will:
1. Execute adversarial verification
2. Present issues one-by-one via AskUserQuestion
3. Apply fixes immediately when selected
4. Continue until all issues resolved or user stops early
```

### 6. Evaluate Result

Parse BlindQA output for verdict:

**Case A: PASS**
- All checks passed with evidence
- Emit success signal:
  ```bash
  bun .collab/handlers/emit-blindqa-signal.ts pass "All ${check_count} checks passed with evidence"
  ```
- Exit successfully (pipeline advances to done/next phase)

**Case B: FAIL**
- One or more checks failed
- If `attempt < max_attempts`:
  - Increment `attempt`
  - Present failure summary to user (or use interactive mode fixes)
  - Go to Step 5 (retry verification)
- If `attempt >= max_attempts`:
  - Emit failure signal:
    ```bash
    bun .collab/handlers/emit-blindqa-signal.ts fail "${issue_count} issues remain after ${max_attempts} attempts"
    ```
  - Report issues and exit (pipeline halts for manual intervention)

### 7. Exit Strategy

**Success Path:**
- Emit BLINDQA_PASS signal
- Output: "✅ Blind verification PASSED - all checks confirmed with evidence"
- Exit code 0

**Failure Path (max retries exceeded):**
- Emit BLINDQA_FAIL signal
- Output: "❌ Blind verification FAILED after ${max_attempts} attempts - ${issue_count} issues remaining"
- List unresolved issues
- Exit code 1

**Error Path:**
- Emit BLINDQA_ERROR signal if unexpected error occurs
- Output error details
- Exit code 1

## Signal Protocol Summary

1. **BLINDQA_START** - Sent once at beginning of first attempt
2. **BLINDQA_PASS** - Sent when all checks pass with evidence
3. **BLINDQA_FAIL** - Sent when max retries exceeded with unresolved issues

**Orchestrator Integration:**
- Orchestrator waits for BLINDQA_PASS or BLINDQA_FAIL signal
- On PASS: Advance to done (pipeline complete)
- On FAIL: Halt pipeline, require manual intervention

## Interactive Mode Notes

When `--interactive` flag is present:
- BlindQA presents issues one-by-one via AskUserQuestion
- User selects fix option
- Fix applied immediately
- No explicit retry loop needed (user iterates within BlindQA)
- Emit PASS after all issues resolved or FAIL if user stops early

## Example Invocations

**Default (batch mode):**
```
collab.blindqa BRE-191
```

**Interactive mode:**
```
collab.blindqa BRE-191 --interactive
```

## Design Rationale

This command follows the proven `collab.clarify` pattern:
- **Deterministic signals** via explicit Bash calls (not hooks)
- **Orchestration boundary** separated from skill logic
- **BlindQA skill stays clean** for standalone use
- **Retry loop** built into orchestrated variant (not in skill)
- **Signal contract** documented and versioned independently

Implements Option 3 (hybrid orchestrated variant) from Council debate - Adapter pattern separating infrastructure (signaling) from domain (adversarial QA).
