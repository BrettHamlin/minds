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
bun .collab/handlers/emit-signal.ts start "Starting blind verification (attempt ${attempt}/${max_attempts})"
```

This is MANDATORY before invoking BlindQA skill. The signal must be sent before verification begins so orchestrator can track progress.

### 5. Web Feature Detection — Start Dev Server

Before invoking BlindQA, detect if this is a web/frontend feature and start the appropriate dev server:

```bash
# Check for Hugo static site
if [ -f "hugo.toml" ] || [ -f "config.toml" ] || [ -f "config/_default/hugo.toml" ]; then
  echo "[BlindQA] Hugo site detected — starting dev server on port 1314"
  hugo server --port 1314 --bind 0.0.0.0 --baseURL http://localhost:1314 --buildDrafts --navigateToChanged=false &
  HUGO_PID=$!
  sleep 3
  echo "[BlindQA] Dev server ready at http://localhost:1314 (PID: $HUGO_PID)"
  WEB_BASE_URL="http://localhost:1314"
  IS_WEB_FEATURE=true

# Check for Node.js/Bun dev server (package.json with dev script)
elif [ -f "package.json" ] && grep -q '"dev"' package.json; then
  echo "[BlindQA] Node/Bun site detected — starting dev server"
  bun run dev &
  DEV_PID=$!
  sleep 5
  WEB_BASE_URL="http://localhost:3000"
  IS_WEB_FEATURE=true
else
  IS_WEB_FEATURE=false
fi
```

### 5a. Playwright Browser Verification (Web Features Only)

If `IS_WEB_FEATURE=true`, use the Playwright skill to verify UI acceptance criteria from the ticket BEFORE BlindQA adversarial testing:

**Read the ticket's acceptance criteria** from the feature spec (`specs/*/spec.md`) or from memory (provided when invoking collab.blindqa). Then invoke:

```
Skill: playwright-skill
Args: Test the following acceptance criteria at ${WEB_BASE_URL}:

[List each acceptance criterion from the ticket as a specific test instruction]

For BRE-233 (font size stepper), test:
1. Navigate to an article page (any /briefing/* or /u/* URL)
2. Verify a font size stepper (− and + buttons) appears to the right of Sans/Serif selector
3. Click + and verify .post-content font-size increases
4. Click − and verify .post-content font-size decreases
5. Verify + is disabled when step count is +5 (click 5 times from 0)
6. Verify − is disabled when step count is −5 (click 5 times from 0)
7. Verify font size is saved to localStorage key 'paperclips-font-size' after clicking
8. Reload the page and verify the saved font size is restored (no flash)
9. Verify article title/header/nav are NOT scaled by the stepper
10. Verify Sans/Serif toggle still works independently of the stepper

Provide screenshots as evidence. Report PASS or FAIL for each criterion.
```

**Collect Playwright results.** If Playwright reports failures, attempt to diagnose whether:
- The implementation is missing entirely (issue for agent to fix before blindqa)
- The test script had an error (retry the test)
- The criterion is genuinely failing (legitimate FAIL)

### 5b. Invoke BlindQA Skill

After Playwright verification (or if not a web feature), use the Skill tool to invoke BlindQA:

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

### 5c. Cleanup Dev Server

After all verification is complete (pass or fail), stop the dev server if started:

```bash
if [ -n "${HUGO_PID:-}" ]; then kill $HUGO_PID 2>/dev/null || true; fi
if [ -n "${DEV_PID:-}" ]; then kill $DEV_PID 2>/dev/null || true; fi
```

### 6. Evaluate Result

Combine evidence from **both** Playwright (step 5a) and BlindQA (step 5b):

**Case A: PASS**
- All checks passed with evidence from Playwright AND BlindQA
- Both must agree: Playwright shows each AC green, BlindQA reports no issues
- Emit success signal:
  ```bash
  bun .collab/handlers/emit-signal.ts pass "All ${check_count} checks passed with evidence"
  ```
- Exit successfully (pipeline advances to done/next phase)

**Case B: FAIL**
- One or more checks failed (from either Playwright or BlindQA)
- If `attempt < max_attempts`:
  - Increment `attempt`
  - Present failure summary to user (or use interactive mode fixes)
  - Go to Step 5 (retry verification)
- If `attempt >= max_attempts`:
  - Emit failure signal:
    ```bash
    bun .collab/handlers/emit-signal.ts fail "${issue_count} issues remain after ${max_attempts} attempts"
    ```
  - Report issues and exit (pipeline halts for manual intervention)

### 7. Exit Strategy

**Success Path:**
- Emit a pass signal
- Output: "✅ Blind verification PASSED - all checks confirmed with evidence"
- Exit code 0

**Failure Path (max retries exceeded):**
- Emit a failure signal
- Output: "❌ Blind verification FAILED after ${max_attempts} attempts - ${issue_count} issues remaining"
- List unresolved issues
- Exit code 1

**Error Path:**
- Emit an error signal if unexpected error occurs
- Output error details
- Exit code 1

## Signal Protocol Summary

1. **Start signal** - Sent once at beginning of first attempt
2. **Pass signal** - Sent when all checks pass with evidence
3. **Failure signal** - Sent when max retries exceeded with unresolved issues

**Orchestrator Integration:**
- Orchestrator waits for the terminal signal (pass or fail)
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
