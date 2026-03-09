# Critique Workflow

Adversarial analysis of specification text to find gaps, ambiguities, and missing details before implementation.

## Loop Logic Summary (Critical Requirements)

**This workflow uses pass-specific logic with mandatory minimum passes:**

1. **PASS 1 (First iteration):**
   - Asks about ALL severity levels (HIGH, MEDIUM, LOW)
   - Cannot skip any issues
   - Always executes regardless of results

2. **PASS 2+ (Subsequent iterations):**
   - Checks for HIGH-severity issues
   - If HIGH issues found → Ask about ALL severities (HIGH, MEDIUM, LOW)
   - If NO HIGH issues → EXIT (MEDIUM/LOW acceptable)

3. **Minimum Requirement:**
   - Always runs at least 2 passes
   - Pass 1 always proceeds to Pass 2
   - Pass 2+ uses HIGH-severity gate for exit decision

4. **Exit Condition:**
   - A pass completes with ZERO HIGH severity issues
   - MEDIUM/LOW issues do not prevent exit after Pass 2+

5. **Safety Valve:**
   - Maximum 5 passes
   - Exit with warning if HIGH issues remain after 5 passes

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

## Step 4: Resolve Issues (Iterative Loop with Pass-Specific Logic)

**Quality Gate:** Must resolve ALL HIGH severity issues before proceeding.

### Pass-Specific Behavior

**PASS 1 (First iteration - MANDATORY):**
- **Ask about ALL severity levels:** HIGH, MEDIUM, LOW
- **Cannot skip any issues**
- **Always runs** regardless of results

**PASS 2+ (Subsequent iterations):**
- **Check for HIGH issues:**
  - **If HIGH issues found:** Ask about ALL severity levels (HIGH, MEDIUM, LOW)
  - **If NO HIGH issues:** EXIT loop (MEDIUM/LOW acceptable)
- **Minimum requirement:** Always runs at least 2 passes

**Exit Condition:** A pass completes with ZERO HIGH severity issues

### Loop Structure

**Initialize pass counter:**
```
current_pass = 1
max_passes = 5
```

### For Each Pass

**Determine which issues to address:**

```
if (current_pass === 1) {
  // PASS 1: Address ALL issues
  issues_to_address = [ALL HIGH, MEDIUM, LOW issues]
  reason = "First pass - cannot skip any severity level"
} else {
  // PASS 2+: Check for HIGH issues
  if (HIGH_issues_exist) {
    issues_to_address = [ALL HIGH, MEDIUM, LOW issues]
    reason = "HIGH issues found - addressing all severities"
  } else {
    // EXIT: No HIGH issues, only MEDIUM/LOW remain
    exit_loop = true
    reason = "No HIGH issues found - spec is hardened"
  }
}
```

**For each issue to address:**

1. **Use AskUserQuestion tool** to clarify:

```
{
  questions: [{
    question: "<Specific question about the issue>",
    header: "<Issue category> [SEVERITY]",
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

4. **Move to next issue**

### After Pass Completion

Present summary:

```markdown
✅ **Pass [N] complete - [COUNT] issues resolved**

**Resolutions:**
1. [Issue 1 - SEVERITY] → Resolved: [Answer]
2. [Issue 2 - SEVERITY] → Resolved: [Answer]
3. [etc...]

**Updated sections:**
- [Section 1]
- [Section 2]
```

---

## Step 5: Re-Analyze (Iteration Check with Pass Logic)

After resolving issues, re-analyze the updated spec:

**Purpose:** Fixes can introduce new ambiguities or expose hidden gaps.

Run full analysis again (Step 2) on the updated spec.

### Iteration Decision Logic

```
current_pass++

if (current_pass === 2) {
  // FIRST RE-ANALYSIS (after Pass 1)
  // ALWAYS run Pass 2 (minimum 2-pass requirement)
  if (HIGH_issues_found) {
    action = "Continue - HIGH issues found, will address all severities"
  } else if (MEDIUM_or_LOW_issues_found) {
    action = "Continue - but this is Pass 2, will check if HIGH exist"
  } else {
    action = "Continue - Pass 2 required even with zero issues"
  }
  // Return to Step 3 for Pass 2
}

if (current_pass > 2) {
  // SUBSEQUENT RE-ANALYSIS (Pass 3+)
  // HIGH-severity gate: only continue if HIGH issues exist
  if (HIGH_issues_found) {
    action = "Continue - HIGH issues require resolution"
    // Return to Step 3 for next pass
  } else {
    action = "EXIT - No HIGH issues, spec is hardened"
    // Continue to Step 6
  }
}

if (current_pass >= max_passes) {
  // SAFETY VALVE
  action = "EXIT - Max iterations reached (5 passes)"
  warning = "HIGH issues remain but max iterations reached"
  // Continue to Step 6 with warning
}
```

### Iteration Outcomes

**Case A: Pass 1 complete**
- **ALWAYS proceed to Pass 2** (minimum 2-pass requirement)
- Regardless of issue count

**Case B: Pass 2 complete**
- **Check HIGH issues:**
  - HIGH issues found → Continue to Pass 3
  - NO HIGH issues → EXIT (MEDIUM/LOW acceptable)

**Case C: Pass 3+ complete**
- **HIGH-severity gate:**
  - HIGH issues found → Continue to next pass (if under max_passes)
  - NO HIGH issues → EXIT (spec hardened)

**Case D: Max passes reached (5)**
- **Safety valve:** Exit with warning if HIGH issues remain
- Prevents infinite loops

**Rationale:**
- **Minimum 2 passes:** Ensures at least one re-analysis after fixes
- **HIGH-severity gate:** Prevents endless iteration on MEDIUM/LOW issues
- **Iterative analysis catches:**
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

**Hardened Spec (for Step 7):**

Generate the complete hardened specification by integrating all clarifications into the original spec:

1. **Take original spec structure** (Type, Description, Implementation Details, Testing, Dependencies, Success Criteria)
2. **Integrate all clarifications** from resolved issues:
   - Add new sections where gaps were filled (e.g., "Error Handling & Logging", "Concurrency Model", "Out of Scope")
   - Update existing sections with clarifications (e.g., add retry logic to error handling)
   - Ensure AI-consumable format (clear, structured, unambiguous)
3. **Format for Linear** - Complete markdown with all sections preserved
4. **Store as `hardened_spec`** for Step 7 to persist

**Example integration:**
- HIGH issue "Logging undefined" → Add "Error Handling & Logging" section with structured JSON format details
- MEDIUM issue "Out-of-scope unclear" → Add "Out of Scope" section with explicit boundaries
- All resolutions become part of the canonical spec, not just metadata
```

---

## Step 7: Update Linear Ticket (Mandatory when changes exist)

**Condition:** If any issues were resolved (total_issues_resolved > 0), this step is MANDATORY.

**Rationale:** Clarifications gathered during analysis must be persisted to Linear. Skipping this step loses all work and leaves the spec in its original ambiguous state.

If ticket_id was provided AND issues were resolved:

**Automatically update Linear ticket** (no user confirmation needed):

```typescript
// Use the hardened_spec generated in Step 6
const updatedDescription = `${hardened_spec}

---
## SpecCritique Analysis

**Status:** HARDENED (${high_issues_resolved} HIGH issues resolved)
**Analysis Date:** ${new Date().toISOString()}
**Total Issues Resolved:** ${total_issues_resolved} (${high_issues_resolved} HIGH, ${medium_issues_resolved} MEDIUM, ${low_issues_resolved} LOW)

### Resolved Issues:
${resolved_issues.map(issue => `- **[${issue.severity}] ${issue.category}**: ${issue.resolution}`).join('\n')}

---
*Analyzed by SpecCritique skill - Spec hardened and ready for implementation*
`

// Update Linear
mcp__plugin_linear_linear__update_issue({
  id: ticket_id,
  description: updatedDescription
})
```

**If no issues were resolved (spec was already clean):**
- Skip Linear update (no changes to persist)
- Log: "Spec was already clean - no Linear update needed"

**Output:**
- "✅ Linear ticket {ticket_id} updated with hardened spec"
- "📝 {total_sections_added} new sections added, {existing_sections_updated} sections updated"

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

### Example 3: Iterative Refinement (New Pass Logic)

```
Pass 1 (Initial):
→ Found: 2 HIGH, 3 MEDIUM, 1 LOW
→ Asked about ALL 6 issues (first pass - cannot skip)
→ Resolved all 6
→ Re-analyze
→ Must proceed to Pass 2 (minimum 2-pass requirement)

Pass 2 (Required):
→ Found: 1 NEW HIGH issue (exposed by previous fixes)
→ HIGH issue found - ask about ALL severities
→ Found: 1 HIGH, 1 MEDIUM
→ Resolved both
→ Re-analyze
→ Check HIGH-severity gate

Pass 3:
→ Found: 0 HIGH issues, 2 MEDIUM issues remain
→ HIGH-severity gate: EXIT (no HIGH issues)
→ Report: "✅ Spec hardened in 3 passes"
```

### Example 4: Quick Exit (But Still 2 Passes)

```
Pass 1:
→ Found: 0 HIGH, 1 MEDIUM, 1 LOW
→ First pass - asked about all 2 issues
→ Resolved both
→ Re-analyze
→ Must proceed to Pass 2 (minimum requirement)

Pass 2:
→ Found: 0 HIGH, 0 MEDIUM, 0 LOW
→ HIGH-severity gate: EXIT (no HIGH issues)
→ Report: "✅ Spec hardened in 2 passes (minimum met)"
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
