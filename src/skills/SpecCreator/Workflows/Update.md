# Update Workflow

Enhance an existing Linear ticket with comprehensive AI-consumable specification.

## Voice Notification

```bash
curl -s -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Running the Update workflow in the SpecCreator skill to enhance existing Linear ticket"}' \
  > /dev/null 2>&1 &
```

Running the **Update** workflow in the **SpecCreator** skill to enhance existing Linear ticket...

---

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

## Step 3: Determine Enhancement Approach

Use AskUserQuestion:

**Question:** "How would you like to enhance this spec?"

**Options:**
1. **Complete missing sections** - Keep existing content, add what's missing
2. **Restructure and enhance** - Reorganize into AI-consumable format and fill gaps
3. **Start fresh** - Replace with new spec (preserves ticket metadata)

Store the approach.

---

## Step 4: Follow Create Workflow with Pre-population

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] Existing ticket fetched and analyzed (Steps 1-2 complete)
- [ ] Enhancement approach determined (Step 3 complete)
- [ ] Ready to enhance spec sections

Based on the selected enhancement approach:

### If "Complete missing sections":
1. Pre-populate the spec with existing content
2. Identify which sections are missing:
   - If no clear type: Ask using Create.md Step 1
   - If no implementation details: Ask using Create.md Step 2 (or offer Council)
     - **If Council is used:** Follow Create.md Steps 3.3-3.4 for feedback loop (Present recommendation → Get feedback → Handle feedback)
   - If no testing strategy: Ask using Create.md Step 6
   - If no dependencies: Ask using Create.md Step 7
3. Skip BlindQA for sections that already exist and are complete
4. Run BlindQA on the enhanced spec as a whole

### If "Restructure and enhance":
1. Pre-populate with existing content as starting point
2. Ask: "Does the spec type look correct: [detected type]?" (Yes/No with correction)
3. Present existing description and ask: "Keep this description or revise it?" (Keep/Revise)
4. For each section (Implementation/Testing/Dependencies):
   - Show existing content if present
   - Ask: "Keep, revise, or replace this section?"
   - If revise/replace: Follow Create.md flow for that section
     - **If Council is used:** Follow Create.md Steps 3.3-3.4 for feedback loop (Present recommendation → Get feedback → Handle feedback)
5. Run BlindQA on the complete restructured spec

### If "Start fresh":
1. Preserve only the ticket metadata (team, labels, priority)
2. Follow Create.md workflow Steps 1-7 completely
3. Run full BlindQA validation

---

## Step 5: BlindQA Validation (Iterative Loop)

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] All spec sections enhanced (Step 4 complete)
- [ ] Testing strategy defined
- [ ] Dependencies documented
- [ ] Spec is complete and ready for validation

**Quality Gate: BlindQA runs iteratively until zero HIGH severity issues remain.**

### BlindQA Loop

**Iteration 1:** Run BlindQA in interactive mode:

```
Invoke BlindQA skill with:
--interactive
Prompt: "Analyze this enhanced Linear ticket specification. Find gaps, ambiguities, missing details, and potential issues. This spec will be consumed by an AI engineer, so it must be completely unambiguous.

Original ticket: [ticket-id]
Enhancement approach: [approach from Step 3]

[Enhanced spec]"
```

**After BlindQA completes:**
- Update the spec with feedback and fixes
- **Check severity counts:**
  - If HIGH severity issues were found → Go to Iteration 2
  - If only MEDIUM/LOW or ZERO issues found → Exit loop, continue to Step 6

**Iteration 2:** (Only if HIGH severity issues found in Iteration 1)

Run BlindQA again on the updated spec:

```
Invoke BlindQA skill with:
--interactive
Prompt: "Re-analyze this enhanced Linear ticket specification after fixes. Find any remaining gaps, ambiguities, or issues introduced by the changes. This spec will be consumed by an AI engineer."

[Updated spec with Iteration 1 fixes]
```

**After second BlindQA completes:**
- Update spec with new findings
- **Check severity counts:**
  - If HIGH severity issues were found → Go to Iteration 3
  - If only MEDIUM/LOW or ZERO issues found → Exit loop, continue to Step 6

**Iteration 3:** (Only if HIGH severity issues found in Iteration 2)

Final BlindQA run (safety limit):

```
Invoke BlindQA skill with:
--interactive
Prompt: "Final re-analysis of this enhanced Linear ticket specification. Find any remaining gaps or issues."

[Updated spec with Iteration 2 fixes]
```

**After third BlindQA completes:**
- Update spec with findings
- **If HIGH severity issues still remain:** Warn user that maximum iterations reached, but continue to Step 6 anyway
- Otherwise: Continue to Step 6

**Loop Rationale:** Fixing high severity issues can introduce new problems or reveal hidden gaps. Iterative validation ensures the spec reaches a stable, unambiguous state before updating Linear.

---

## Step 6: Update Linear Ticket

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] BlindQA validation complete (Step 5 complete)
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

**BlindQA Findings Addressed:**
- [List of issues found and how they were resolved]

**Next Steps:**
1. Review the updated ticket at [URL]
2. Verify the enhancements meet your needs
3. Update sprint/milestone if needed
```

---

## Complete

Existing Linear ticket enhanced with comprehensive AI-consumable specification. The ticket now contains all necessary sections for implementation.
