# Update Workflow

Enhance an existing Linear ticket with comprehensive AI-consumable specification.

## Step 1: Fetch Existing Linear Issue

Use AskUserQuestion to get the Linear ticket identifier:

**Question:** "What's the Linear ticket ID or URL you want to enhance?"

**Instructions:**
"Provide either:
- Linear ticket ID (e.g., BRE-123)
- Full Linear URL
- Just the ticket number (e.g., 123)"

Parse the input and fetch the Linear issue using the Linear MCP tool:

```
mcp__plugin_linear_linear__get_issue
{
  "id": "[ticket-id]"
}
```

Store the existing issue data:
- Current title
- Current description/body
- Type (if determinable from labels/state)
- Team
- Priority
- Labels
- Any other metadata

---

## Step 2: Analyze Existing Content

Parse the existing description to extract:
- What type of spec this appears to be (Feature/Bug/Research)
- Any existing implementation details
- Any existing testing information
- Any existing dependency information

Present to user:

**Current Ticket Content:**
```
Title: [title]
Type: [detected type or "Unknown"]

Existing Description:
[first 500 chars of description...]

Existing Implementation Details: [Yes/No - summary if present]
Existing Testing Strategy: [Yes/No - summary if present]
Existing Dependencies: [Yes/No - summary if present]
```

---

## Step 3: Auto-Analyze Spec Completeness

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] Existing ticket fetched (Step 1 complete)
- [ ] Content analyzed (Step 2 complete)
- [ ] Type detected or unknown
- [ ] Ready to determine enhancement strategy

**Automatic analysis - no user input required:**

Based on Step 2 findings, automatically determine the enhancement approach:

1. **Auto-detect spec type:**
   - Check Linear labels for "bug", "feature", "research", "analysis"
   - Check description keywords: "broken", "error", "fails" → Bug
   - Check description keywords: "add", "new", "implement" → Feature
   - Check description keywords: "investigate", "analyze", "research" → Research
   - If still unclear: default to Feature

2. **Auto-analyze completeness:**
   - Missing implementation details? → Need Council research + priorities
   - Missing testing strategy? → Need testing questions (Create.md Step 5)
   - Missing dependencies? → Need dependency questions (Create.md Step 6)
   - Missing all sections? → Full enhancement needed

3. **Auto-revise description for AI clarity:**
   - Always rewrite description to be AI-consumable
   - Remove ambiguity, add explicit context
   - Preserve user intent but clarify wording
   - This is automatic - the goal is AI consumption, not preservation

4. **Determine enhancement path:**
   - If missing 0-1 sections: "Complete missing sections" path
   - If missing 2+ sections OR type unclear: "Restructure and enhance" path
   - (Ignore "Start fresh" - preserving work is default)

Store the auto-determined approach and proceed to Step 4.

**Edge case only:** If truly ambiguous (rare - e.g., description is empty or nonsensical), use AskUserQuestion:
- "The ticket description is unclear. What is this ticket about?" (free text)
- Parse response and continue with auto-analysis

---

## Step 4: Enhance Spec Sections

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] Existing ticket fetched and analyzed (Steps 1-2 complete)
- [ ] Enhancement approach auto-determined (Step 3 complete)
- [ ] Ready to enhance missing sections

Based on auto-determined path from Step 3:

**Path A: "Complete missing sections" (missing 0-1 sections)**

1. Pre-populate spec with existing content (already AI-clarified from Step 3)
2. For each MISSING section:
   - **Implementation details missing?**
     - Follow Create.md Step 2 (Analyze feature type → Council generates multiple approaches → user selects)
   - **Testing strategy missing?**
     - Follow Create.md Step 5 (ask testing questions)
   - **Dependencies missing?**
     - Follow Create.md Step 6 (ask dependency questions)
3. Generate success criteria if missing
4. Continue to Step 5 (SpecCritique validation)

**Path B: "Restructure and enhance" (missing 2+ sections OR unclear type)**

1. Start with AI-clarified description from Step 3 (already revised automatically)
2. Auto-detected type from Step 3 is used (no confirmation needed)
3. Run Council research for implementation approach:
   - Follow Create.md Step 2 (Analyze feature type → Council generates multiple approaches → user selects)
4. Ask testing strategy questions:
   - Follow Create.md Step 5
5. Ask dependency questions:
   - Follow Create.md Step 6
6. Generate success criteria based on selected approach + testing
7. Continue to Step 5 (SpecCritique validation)

---

## Step 5: SpecCritique Validation (Iterative Loop)

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] All spec sections enhanced (Step 4 complete)
- [ ] Testing strategy defined
- [ ] Dependencies documented
- [ ] Spec is complete and ready for validation

**Quality Gate: SpecCritique runs iteratively until zero HIGH severity issues remain.**

### Why SpecCritique (Not BlindQA)

- **SpecCritique** analyzes SPEC TEXT for gaps, ambiguities, missing requirements BEFORE implementation
- **BlindQA** verifies RUNNING CODE after implementation
- This is the early quality gate (spec hardening), BlindQA is the late quality gate (code verification)

### SpecCritique Invocation

Invoke the SpecCritique skill:

```
Use Skill tool:
Skill: SpecCritique
Args: [ticket-id from Step 1]

Provide the enhanced spec as context:
[Enhanced spec from Step 4]
```

**SpecCritique will:**
1. Analyze spec across all categories (functional scope, data model, UX flow, edge cases, terminology, etc.)
2. Identify gaps and rank severity: HIGH (blockers), MEDIUM (important), LOW (nice to have)
3. Ask clarifying questions via AskUserQuestion for HIGH issues
4. Update spec with answers
5. Re-analyze until zero HIGH issues remain (max 5 iterations)
6. Return hardened spec with final report

**After SpecCritique completes:**
- Take the hardened spec from SpecCritique
- Store the updated spec with all gaps filled
- **Check the verdict:**
  - If **HARDENED** (zero HIGH issues) → Continue to Step 6
  - If **WARNING** (only MEDIUM/LOW issues) → Continue to Step 6 with warning
  - If **BLOCKED** (HIGH issues remain after max iterations) → Error and exit

**Loop Rationale:** SpecCritique has an INTERNAL iterative loop that re-analyzes after fixes until zero HIGH issues. The skill itself handles the iteration, not this workflow.

---

## Step 6: Update Linear Ticket

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] SpecCritique validation complete (Step 5 complete)
- [ ] All feedback incorporated
- [ ] Spec is final and ready to update Linear

Use the Linear MCP tool to update the existing issue:

```
mcp__plugin_linear_linear__update_issue
{
  "id": "[ticket-id]",
  "description": "[formatted enhanced spec]"
}
```

**Format the enhanced spec for Linear:**
```markdown
# [Title - updated if needed]

## Type
[Bug | Feature | Research/Analysis]

## Description
[Enhanced description]

## [Implementation Details | Reproduction Steps | Research Approach]
[Enhanced or newly added details]

## Testing Strategy
[Enhanced or newly added testing strategy]

## Dependencies & Setup
[Enhanced or newly added dependencies]

## Success Criteria
[Enhanced or newly added success criteria]

---
*Enhanced by SpecCreator skill - AI-consumable specification*
*Original ticket: [ticket-id]*
*Enhancement approach: [approach]*
*Enhanced on: [date]*
```

Store the updated ticket URL.

---

## Step 7: Show Changes Summary

Present a comprehensive diff-style summary:

```
✅ **Linear Ticket Enhanced Successfully**

**Ticket:** [Linear ticket ID and URL]

**Enhancement Approach:** [Complete missing sections | Restructure and enhance | Start fresh]

**Changes Made:**

**Title**
- Before: [old title]
- After: [new title] (if changed)

**Description**
- [Added new description | Enhanced existing | Kept unchanged]

**Implementation Details**
- [Added | Enhanced | Replaced | Kept unchanged]
- Key changes: [bullet points of what changed]

**Testing Strategy**
- [Added | Enhanced | Replaced | Kept unchanged]
- Key additions: [what was added]

**Dependencies**
- [Added | Enhanced | Replaced | Kept unchanged]
- New dependencies identified: [list]

**SpecCritique Findings Addressed:**
- [List of issues found and how they were resolved]

**Next Steps:**
1. Review the updated ticket at [URL]
2. Verify the enhancements meet your needs
3. Update sprint/milestone if needed
```

---

## Complete

Existing Linear ticket enhanced with comprehensive AI-consumable specification. The ticket now contains all necessary sections for implementation.
