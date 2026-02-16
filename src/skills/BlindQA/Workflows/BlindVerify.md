# BlindVerify Workflow

## Voice Notification

```bash
curl -s -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Running the BlindVerify workflow in the BlindQA skill to perform adversarial verification"}' \
  > /dev/null 2>&1 &
```

Running **BlindVerify** in **BlindQA**...

---

Perform independent, adversarial verification of a completed implementation with zero implementation context.

## ABSOLUTE REQUIREMENT: tmux send-keys MUST end with `Enter`

**THIS IS THE #1 FAILURE MODE. READ THIS BEFORE DOING ANYTHING.**

Every single `tmux send-keys` command — without exception — MUST include `Enter` as the final, separate argument. Text sent to tmux without `Enter` is typed into the terminal but **NEVER SUBMITTED**. It sits there doing nothing until someone manually presses Return. This has caused workflow stalls repeatedly where the user had to manually intervene.

```
CORRECT:  tmux send-keys -t "BRE-120" "/speckit.clarify" Enter
WRONG:    tmux send-keys -t "BRE-120" "/speckit.clarify"

CORRECT:  tmux send-keys -t "BRE-120" "A" Enter
WRONG:    tmux send-keys -t "BRE-120" "A"

CORRECT:  tmux send-keys -t "BRE-120" "yes" Enter
WRONG:    tmux send-keys -t "BRE-120" "yes"
```

**Before executing ANY `tmux send-keys` call, visually confirm that the word `Enter` appears as the last argument.** If it does not, add it. There are ZERO exceptions to this rule. This applies to:
- The initial command being sent
- Every answer to a question
- Any follow-up text sent to the tmux window
- Literally every single `tmux send-keys` invocation

---

## Input

- **ticket_id** (required): Linear ticket ID (e.g., BRE-134)
- OR **verification_spec** (required): Manual verification spec with checks, criteria, and URLs

## Step 1: Extract Test Spec

Read the Linear ticket and extract ONLY these sections:

```
- Problem description (what the expected behavior is)
- Verification table (checks, how-to-verify, pass criteria)
- Local server URLs and setup instructions
- Visual mockup links (if any)
```

**STRIP everything else.** Specifically remove:
- Root Cause Investigation
- What to Fix / implementation approach
- Files to Inspect / Files to Modify
- Git branch names
- Any implementation details or "here's what changed" context

## Step 2: Compose QA Agent Prompt

Build the agent prompt using this template:

```
You are an independent QA verifier. Your job is to BREAK this implementation,
not confirm it works.

You have ZERO knowledge of what was changed or how. You only know:
1. What the expected behavior is
2. Where to test it
3. How to verify each check
4. What passes and what fails

## Expected Behavior
[extracted from ticket — problem + expected behavior only]

## Visual Reference
[mockup URL if available]

## Test Environment
- Frontend: http://localhost:1313
- Backend: http://localhost:8787
- [any setup instructions — creating test users, etc.]

## Verification Checks
[extracted verification table]

## Rules
- Use the Playwright skill (Browser) for ALL verification. Never curl.
- Take a screenshot for EVERY check. No exceptions.
- For each check, report:
  - WHAT you tested
  - WHAT you expected
  - WHAT you actually found
  - EVIDENCE (screenshot path or DOM extract)
  - VERDICT: PASS or FAIL with justification
- After each PASS, ask yourself: "What if I'm wrong?" and probe deeper.
- Inspect the DOM, not just the visual. Extract attribute values. Count elements.
- If something looks right but you're not 100% sure, dig deeper.
- Do NOT assume the page is correct because it rendered without errors.

## Final Report Format

For each check:
### Check [number]: [name]
- **Tested:** [what you did]
- **Expected:** [pass criteria]
- **Observed:** [what you actually found]
- **Evidence:** [screenshot path or DOM data]
- **Verdict:** PASS / FAIL
- **Confidence:** [High/Medium/Low + why]

### Overall Verdict
- **PASS**: All checks passed with high confidence and evidence
- **FAIL**: One or more checks failed — list which ones and why
```

## Step 3: Launch QATester Agent

```
Spawn agent:
  subagent_type: QATester
  prompt: [composed prompt from Step 2]
```

The agent runs autonomously. No interaction.

## Step 4: Evaluate Results

When the QA agent returns:

1. **Check evidence completeness** — every check must have a screenshot or DOM extract
2. **Check confidence levels** — any "Low" confidence checks need investigation
3. **Validate screenshots exist** — read the screenshot files to confirm they're real
4. **Final determination:**
   - All PASS with evidence -> Implementation verified. Report to user.
   - Any FAIL -> If `--interactive` flag present, proceed to Step 4b. Otherwise, report failures as text and halt.

## Step 4b: Interactive Resolution Flow (when --interactive flag present)

**Conditional Entry**: This step only executes when BOTH conditions are true:
1. The `--interactive` flag was provided with the `/blind-qa` command
2. The QA agent found one or more issues (verification FAILED)

If interactive mode is enabled but all checks PASSED, skip this step and report success normally.

### Issue Presentation Loop

For each issue found by the QA agent (Issue 1 of N, Issue 2 of N, etc.):

1. **Present Issue via AskUserQuestion**:
   ```
   Use AskUserQuestion tool with:
   - question: "How would you like to resolve this issue?"
   - header: "Issue X of N"
   - options: 2-4 resolution choices based on issue finding
   ```

   **Include in question description**:
   - Issue ID (e.g., V1-dark-mode)
   - Severity (High/Medium/Low)
   - Finding (the specific problem detected)
   - Evidence link (screenshot path or DOM extract)

   **Resolution options to offer**:
   - "Fix [specific action based on recommendation]" (e.g., "Fix padding in Header.tsx")
   - "Skip this issue"
   - "Stop interactive mode" (dump remaining issues and exit)
   - Additional context-specific options if applicable

2. **Parse User Selection**:
   - Read the user's selected option from AskUserQuestion response
   - If "Stop interactive mode": Dump all remaining issues as text report and halt
   - If "Skip this issue": Increment skipped counter, move to next issue
   - If fix option: Proceed to fix application

3. **Apply Fix Immediately**:
   - Determine appropriate tool based on fix type:
     - File edits → Use Edit tool
     - New files → Use Write tool
     - Command execution → Use Bash tool
   - Execute the fix using the selected tool
   - **Show confirmation**: Output "✓ Fixed: [description of what was changed]"
   - Track success: Increment fixed counter

4. **Progress Tracking**:
   - Maintain counts: `fixed`, `skipped`, `total`
   - Show progress: "Issue X of N" in each AskUserQuestion header
   - After each resolution: "Moving to next issue..." (unless this was the last one)

5. **Continue Loop**:
   - Move to next issue automatically
   - Repeat steps 1-4 until all issues are processed
   - If user selected "Stop interactive mode", exit loop early

### Final Summary

After all issues processed (or user stops interactive mode):

**Output format**:
```
━━━ Interactive resolution complete ━━━
[Status emoji based on results]
✅ X issues fixed, Y skipped, Z total
```

**Status variations**:
- All issues fixed: "✅ All issues resolved"
- Some skipped: List skipped issue IDs for manual review:
  ```
  Skipped: V3-mobile-viewport (manual review needed)
  ```
- User stopped early: Report remaining count:
  ```
  ⚠️ Interactive mode stopped. 2 issues remaining (see text report below)
  [Text dump of remaining issues]
  ```

**Skipped Issues List** (if any):
```
Skipped issue IDs: V3-mobile-viewport, V5-error-handling
```

### Example Flow

```
❌ BLIND QA: FAILED (3 issues found)
Starting interactive resolution...

━━━ Issue 1 of 3 ━━━
ID: V1-dark-mode
Severity: High
Finding: Dark mode toggle button not visible in header
Evidence: /tmp/screenshot-v1.png

How would you like to resolve this?
→ User selects: "Add toggle button to Header.tsx"
✓ Fixed: Added dark mode toggle button to Header.tsx
Moving to next issue...

━━━ Issue 2 of 3 ━━━
ID: V2-pagination
Severity: Medium
Finding: Page 2 returns 404
Evidence: /tmp/screenshot-v2.png

How would you like to resolve this?
→ User selects: "Fix routing in routes.ts"
✓ Fixed: Updated pagination routing in routes.ts
Moving to next issue...

━━━ Issue 3 of 3 ━━━
ID: V3-mobile-viewport
Severity: Low
Finding: Mobile viewport: header overflows container
Evidence: /tmp/screenshot-v3.png

How would you like to resolve this?
→ User selects: "Skip this issue"
⊘ Skipped: V3-mobile-viewport

━━━ Interactive resolution complete ━━━
✅ 2 issues fixed, 1 skipped, 3 total
Skipped: V3-mobile-viewport (manual review needed)
```

## Example

```bash
# Orchestrator extracts from BRE-134:
# - Expected: each date gets its own date divider header
# - Checks: V1-V7 verification table
# - Mockup: https://www.magicpatterns.com/c/wfbzpyzzysr8n5rqnaxl2e
# - Strips: root cause investigation, files to modify, implementation approach

# Spawns QATester with clean test spec
# QATester navigates localhost:1313, runs all checks via Playwright
# Returns verdicts with screenshots for each check
```
