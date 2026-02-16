# Critique Workflow

Adversarial analysis of specification text to find gaps, ambiguities, and missing details before implementation.

## Voice Notification

```bash
curl -s -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Running the Critique workflow in the SpecCritique skill to analyze specification"}' \
  > /dev/null 2>&1 &
```

Running **Critique** in **SpecCritique**...

---

## Input

- **ticket_id** (optional): Linear ticket ID (e.g., BRE-191)
- OR **spec_text** (required): Raw specification text to analyze

## Step 1: Load Specification

### If ticket_id provided:

Fetch the Linear ticket and extract specification:

```
Use Linear MCP tool:
mcp__plugin_linear_linear__get_issue({ id: ticket_id })

Extract:
- Title
- Description (full spec text)
- Type (Feature/Bug/Research)
```

### If spec_text provided:

Use the provided text directly.

---

## Step 2: Analyze Specification

Perform adversarial analysis across these categories:

### Analysis Categories

1. **Functional Scope**
   - Are out-of-scope items clearly defined?
   - Are user roles and permissions specified?
   - Are all actors/stakeholders identified?

2. **Data Model** (if applicable)
   - Are primary keys defined?
   - Are relationships specified?
   - Is data scale/volume mentioned?

3. **UX Flow**
   - Are error states defined?
   - Are loading states specified?
   - Are edge cases handled?

4. **Non-Functional**
   - Are performance targets specified?
   - Is observability/monitoring mentioned?
   - Are rate limits defined?

5. **Integration**
   - Are API contracts clear?
   - Are failure modes specified?
   - Is retry logic defined?

6. **Edge Cases**
   - Is concurrency handled?
   - Is validation specified?
   - Are boundary conditions defined?

7. **Terminology**
   - Are enum values specified?
   - Are ambiguous terms clarified?
   - Is terminology consistent?

### Issue Identification

For each category, identify issues and rank severity:

- **HIGH**: Blocking issue - spec cannot proceed without resolution
  - Example: "User roles undefined - cannot implement permissions"
  - Example: "API contract missing - frontend/backend integration unclear"
  - Example: "Success criteria ambiguous - cannot verify completion"

- **MEDIUM**: Important but not blocking
  - Example: "Performance target not specified - may need revision later"
  - Example: "Error handling incomplete - could improve UX"

- **LOW**: Nice to have
  - Example: "Terminology could be clearer"
  - Example: "Additional edge case worth documenting"

---

## Step 3: Present Issues (First Pass)

Create a summary of all found issues:

```markdown
## SpecCritique Analysis Results

**Total Issues:** X
- HIGH severity: Y (BLOCKING)
- MEDIUM severity: Z
- LOW severity: W

### HIGH Severity Issues (Must Fix)

1. **[Category]** Issue description
   - Current state: What's missing or ambiguous
   - Impact: Why this blocks implementation
   - Suggested resolution: What needs to be clarified

2. [Additional HIGH issues...]

### MEDIUM Severity Issues (Important)

1. [MEDIUM issues...]

### LOW Severity Issues (Nice to Have)

1. [LOW issues...]
```

---

## Step 4: Resolve HIGH Issues (Iterative Loop)

**Quality Gate:** Must resolve ALL HIGH severity issues before proceeding.

### Loop Structure

**For each HIGH severity issue:**

1. **Use AskUserQuestion tool** to clarify:

```
{
  questions: [{
    question: "<Specific question about the HIGH issue>",
    header: "<Issue category>",
    multiSelect: false,
    options: [
      {
        label: "<Option A>",
        description: "<Why this option - with recommendation if applicable>"
      },
      {
        label: "<Option B>",
        description: "<Why this option>"
      },
      {
        label: "Custom answer",
        description: "Provide your own clarification"
      }
    ]
  }]
}
```

2. **Capture answer**

3. **Update spec** with clarification:
   - Add to relevant section
   - Or create new section if needed
   - Document in "Clarifications" section with timestamp

4. **Move to next HIGH issue**

### After All HIGH Issues Resolved

Present summary:

```markdown
✅ **All HIGH severity issues resolved**

**Resolutions:**
1. [Issue 1] → Resolved: [Answer]
2. [Issue 2] → Resolved: [Answer]
3. [etc...]

**Updated sections:**
- [Section 1]
- [Section 2]
```

---

## Step 5: Re-Analyze (Iteration Check)

After resolving HIGH issues, re-analyze the updated spec:

**Purpose:** Fixes can introduce new ambiguities or expose hidden gaps.

Run full analysis again (Step 2) on the updated spec.

### Iteration Outcomes

**Case A: Zero HIGH issues found**
- Exit loop
- Continue to Step 6

**Case B: New HIGH issues found**
- If iteration count < 5: Return to Step 3
- If iteration count >= 5: Warn user, continue to Step 6 anyway (safety valve)

**Rationale:** Iterative analysis catches:
- Ambiguities introduced by clarifications
- Gaps exposed by new details
- Inconsistencies between sections

---

## Step 6: Final Report

Present comprehensive analysis results:

```markdown
## ✅ SpecCritique Complete

**Spec Status:** HARDENED (zero blocking issues)

**Final Issue Count:**
- HIGH: 0 (all resolved)
- MEDIUM: X
- LOW: Y

**Iterations:** Z passes

**Resolved Issues:**
1. [HIGH issue 1] → [Resolution]
2. [HIGH issue 2] → [Resolution]

**Remaining MEDIUM Issues** (non-blocking):
1. [Issue description]
2. [Issue description]

**Remaining LOW Issues** (optional):
1. [Issue description]

**Updated Spec Sections:**
- [Section names that were modified]

**Recommendation:**
✅ Spec is ready for planning/implementation
OR
⚠️ Consider addressing MEDIUM issues before proceeding
```

---

## Step 7: Update Linear Ticket (Optional)

If ticket_id was provided:

Ask user: "Update Linear ticket with hardened spec?"

**If yes:**

```
Use Linear MCP tool:
mcp__plugin_linear_linear__update_issue({
  id: ticket_id,
  description: [updated spec with clarifications]
})
```

Add note at end:
```
---
*Analyzed by SpecCritique skill - [TOTAL ISSUES] issues resolved*
*Analysis date: [TIMESTAMP]*
```

---

## Examples

### Example 1: Clean Spec (No Issues)

```
Input: "Spec for BRE-191"
→ Fetch ticket
→ Analyze: All categories clear, no gaps
→ Report: "✅ Spec is solid - zero issues found"
→ No questions asked
```

### Example 2: Spec with Blocking Issues

```
Input: "Analyze this spec: [text]"
→ Analyze: 3 HIGH, 2 MEDIUM, 1 LOW
→ Present issues summary
→ Ask Question 1: "Which user roles can access this?" (HIGH)
   User answers: "Admin and Manager only"
→ Update spec with answer
→ Ask Question 2: "What happens on network timeout?" (HIGH)
   User answers: "Retry 3 times, then show error"
→ Update spec
→ Ask Question 3: "Define 'processed' status" (HIGH)
   User answers: "Document uploaded and virus-scanned"
→ Update spec
→ Re-analyze: 0 HIGH, 2 MEDIUM, 0 LOW (one LOW fixed by clarifications)
→ Report: "✅ Spec hardened - 3 blocking issues resolved"
```

### Example 3: Iterative Refinement

```
Iteration 1:
→ Found: 2 HIGH issues
→ Resolved both
→ Re-analyze

Iteration 2:
→ Found: 1 NEW HIGH issue (exposed by previous fixes)
→ Resolved
→ Re-analyze

Iteration 3:
→ Found: 0 HIGH issues
→ Exit loop
→ Report: "✅ Spec hardened in 3 iterations"
```

---

## Safety Valves

**Maximum iterations:** 5
- Prevents infinite loops
- If HIGH issues remain after 5 passes, warn user and exit

**Question limit per iteration:** 10
- Prevents overwhelming the user
- Prioritize most critical HIGH issues first

**Total analysis time:** Log start/end for performance tracking

---

## Integration Points

**Called by:**
- SpecCreator Step 5 (validate preliminary spec)
- Standalone invocation via SpecCritique skill
- Orchestrated via collab.spec-critique command (with signals)

**Calls:**
- Linear MCP (fetch/update tickets)
- AskUserQuestion tool (user clarification)

---

## Complete

Spec has been analyzed and hardened. All HIGH severity issues resolved or flagged.
