---
name: SpecCreator
description: Linear ticket spec creation and enhancement system. USE WHEN user wants to create a spec, create a Linear ticket spec, spec out a feature, spec out a bug, create a feature spec, update an existing spec, enhance a Linear ticket, improve a ticket spec, OR mentions creating or updating specifications for Linear tickets, features, bugs, or research tasks.
---

# SpecCreator

AI-consumable Linear ticket specification creation system.

## 🚨 MANDATORY: Voice Notification (REQUIRED BEFORE ANY ACTION)

**You MUST send this notification BEFORE doing anything else when this skill is invoked.**

1. **Send voice notification**:
   ```bash
   curl -s -X POST http://localhost:8888/notify \
     -H "Content-Type: application/json" \
     -d '{"message": "Running the WORKFLOWNAME workflow in the SpecCreator skill to create Linear ticket specification"}' \
     > /dev/null 2>&1 &
   ```

2. **Output text notification**:
   ```
   Running the **WorkflowName** workflow in the **SpecCreator** skill to create Linear ticket specification...
   ```

**This is not optional. Execute this curl command immediately upon skill invocation.**

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Create** | "create a spec", "new spec", "spec this out" | `Workflows/Create.md` |
| **Update** | "update a spec", "enhance this ticket", "improve this spec" | `Workflows/Update.md` |

## Examples

**Example 1: Create a feature spec**
```
User: "Create a spec for adding user authentication to the dashboard"
→ Invokes Create workflow
→ Asks what type of spec (Feature selected)
→ Prompts for feature description and implementation details
→ Optionally uses Council for implementation research
→ Runs BlindQA for spec validation
→ Creates Linear ticket with comprehensive AI-consumable spec
```

**Example 2: Create a bug spec**
```
User: "Spec out this bug - login fails on mobile Safari"
→ Invokes Create workflow
→ Asks what type of spec (Bug selected)
→ Prompts for bug description and reproduction steps
→ Runs BlindQA for clarity check
→ Creates Linear ticket with detailed bug specification
```

**Example 3: Create a research spec**
```
User: "Create an analysis spec for performance bottlenecks"
→ Invokes Create workflow
→ Asks what type of spec (Research/Analysis selected)
→ Prompts for research goals and priorities
→ Uses Council to develop research approach
→ Runs BlindQA for completeness
→ Creates Linear ticket with research specification
```

**Example 4: Update an existing ticket**
```
User: "Update BRE-157 with proper spec format"
→ Invokes Update workflow
→ Fetches existing Linear ticket content
→ Analyzes current state and missing sections
→ Asks how to enhance (complete/restructure/fresh)
→ Fills gaps with same process as Create
→ Updates Linear ticket with enhanced spec
```

## Key Principles

**AI-Consumable Format:**
- All Linear ticket specs are optimized for AI consumption, not human reading
- Clear, structured sections with explicit boundaries
- Unambiguous implementation instructions
- No missing context or edge cases

**Comprehensive Coverage:**
- Implementation details researched and validated
- Testing strategy explicitly defined
- Dependencies and setup documented
- Success criteria clearly stated

**Quality Gates:**
- Council of Councils for implementation research (when requested)
- BlindQA for adversarial validation
- Iterative refinement until approved

## Output Structure

All created Linear tickets follow this structure:

```markdown
# [Ticket Title]

## Type
[Feature | Bug | Research/Analysis]

## Description
[Clear description of what needs to be done]

## Implementation Details
[Specific technical approach and decisions]

## Testing Strategy
[Exact testing approach - what to test, how to test it]

## Dependencies & Setup
[Required services, environment setup, reference docs]

## Success Criteria
[Binary pass/fail criteria for completion]
```
