# Create Workflow

Enhance an existing Linear ticket specification by adding comprehensive, AI-consumable details.

## Voice Notification

```bash
curl -s -X POST http://localhost:8888/notify \
  -H "Content-Type: application/json" \
  -d '{"message": "Running the Create workflow in the SpecCreator skill to enhance Linear ticket specification"}' \
  > /dev/null 2>&1 &
```

Running the **Create** workflow in the **SpecCreator** skill to enhance Linear ticket specification...

---

## Input Parameter

**Required:** Linear issue ID (e.g., BRE-191)

This workflow enhances an EXISTING Linear ticket by adding:
- Council research and priorities
- Testing strategy
- Dependencies and setup requirements
- Multi-repo ownership boundaries (if applicable)
- Adversarial spec validation via SpecCritique

---

## Step 1: Fetch Existing Linear Issue

Use the Linear MCP tool to fetch the ticket:

```
mcp__plugin_linear_linear__get_issue
{
  "id": "[ticket-id from input]"
}
```

**Extract and store:**
- Title
- Description (current spec)
- Type (if present)
- Current state
- Team
- Labels

If the ticket doesn't exist, error and exit.

---

## Step 2: Council Research and Approach Selection

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] Linear issue fetched successfully (Step 1 complete)
- [ ] Title and description extracted
- [ ] Ready to analyze feature type and run Council

### 2.1: Analyze Feature Type and Determine Council Focus

**Meta-reasoning step:** Before invoking Council, analyze what the feature IS to determine what Council should focus on.

**Analyze the feature description to determine primary type:**

| Feature Type | Focus Areas for Council |
|--------------|------------------------|
| **UI/Frontend** | Component architecture, state management, accessibility, responsive design, UX patterns |
| **API/Backend** | Endpoint design, authentication/authorization, data validation, error handling, API patterns |
| **Database/Data** | Schema design, migration strategy, query optimization, indexing, data integrity |
| **Integration** | External API design, webhook patterns, error handling, retry logic, rate limiting |
| **Security/Auth** | Threat modeling, compliance requirements, encryption strategy, audit logging, permission model |
| **Infrastructure** | Deployment strategy, scaling approach, monitoring/observability, infrastructure as code |

**Store the detected feature type and focus areas for Step 2.2.**

### 2.2: Run Council of Councils

Invoke the Council skill with the following prompt:

```
Research implementation approaches for this feature. Provide 3-4 distinct approaches ranked by your recommendation.

Linear Ticket: [ticket-id]
Title: [title from Step 1]
Description:
[description from Step 1]

Feature Type: [type from Step 2.1]
Council Focus Areas: [focus areas from Step 2.1]

When researching approaches, prioritize analysis of the focus areas above. These are the critical dimensions for this feature type.

For EACH approach, provide:
- Approach name (e.g., "REST API with PostgreSQL")
- Technical stack/tools
- Architecture pattern
- Key tradeoffs
- Why you ranked it this position

Output format:
Approach 1 (Recommended): [name]
- Stack: [tools]
- Pattern: [architecture]
- Tradeoffs: [pros/cons]
- Rationale: [why top choice]

Approach 2: [name]
- Stack: [tools]
- Pattern: [architecture]
- Tradeoffs: [pros/cons]
- Rationale: [why second]

[Continue for 3-4 approaches]
```

Wait for Council to complete and return all approaches.

### 2.3: Present Approaches for Selection

Use AskUserQuestion to present Council's research:

**Question:** "Council researched implementation approaches. Which do you want to use?"

**Header:** "Implementation Approach"

**Options:** (Dynamically generate from Council output)

1. **[Approach 1 name] (Recommended)**
   - **Description:** "[Stack, pattern, key tradeoffs - 2-3 sentences]"

2. **[Approach 2 name]**
   - **Description:** "[Stack, pattern, key tradeoffs - 2-3 sentences]"

3. **[Approach 3 name]**
   - **Description:** "[Stack, pattern, key tradeoffs - 2-3 sentences]"

4. **Other** (user enters custom approach in text field)

**Rationale:** Council provides research value (multiple approaches with tradeoffs) while user retains full control in single selection step. No approval loops needed.

Store the selected approach (or user's custom approach from "Other").

---

## Step 3: Build Preliminary Spec

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] Linear issue fetched (Step 1 complete)
- [ ] Council recommendation approved (Step 2 complete)
- [ ] Ready to build enhanced spec

At this point, we have:
- Original ticket title and description
- Council's implementation recommendation

Build a preliminary spec by combining these:

```markdown
# [Original title from ticket]

## Description
[Original description from ticket]

## Implementation Approach
[Council's recommended approach]

## Testing Strategy
[PLACEHOLDER - to be filled in Step 5]

## Dependencies & Setup
[PLACEHOLDER - to be filled in Step 6]

## Success Criteria
[Generate binary pass/fail criteria based on description and approach]
```

Store this preliminary spec.

---

## Step 4: SpecCritique Validation (Iterative Loop)

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] Preliminary spec is built (Step 3 complete)
- [ ] All sections present: Description, Implementation Approach
- [ ] Council feedback incorporated

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
Args: [ticket-id from input]

Provide the preliminary spec as context:
[Preliminary spec from Step 3]
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
  - If **HARDENED** (zero HIGH issues) → Continue to Step 5
  - If **WARNING** (only MEDIUM/LOW issues) → Continue to Step 5 with warning
  - If **BLOCKED** (HIGH issues remain after max iterations) → Error and exit

**Loop Rationale:** SpecCritique has an INTERNAL iterative loop that re-analyzes after fixes until zero HIGH issues. The skill itself handles the iteration, not this workflow.

---

## Step 5: Define Testing Strategy

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] SpecCritique validation complete (Step 4 complete)
- [ ] Spec hardened with zero HIGH issues
- [ ] Ready to define testing approach

Use AskUserQuestion to gather testing requirements:

**Question:** "How should this be tested? Be very specific about the exact testing approach you want."

**Instructions to show user:**
"Provide explicit testing instructions optimized for AI consumption:
- What specific scenarios to test
- How to verify each scenario passes
- What tools to use (Playwright, Vitest, manual testing, etc.)
- What NOT to test or skip
- Expected behavior for each test case

Example:
'Use Playwright to test the login flow:
1. Test valid credentials - should redirect to /dashboard
2. Test invalid credentials - should show error message
3. Test password reset link - should send email and show confirmation
DO NOT test social login (out of scope)
Run with: bun test:e2e'"

Store the testing strategy.

Update the spec's "Testing Strategy" section with this information.

---

## Step 6: Document Dependencies & Setup

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] Testing strategy defined (Step 5 complete)
- [ ] Testing section added to spec
- [ ] Ready to document dependencies

Use AskUserQuestion to gather dependency information:

**Question:** "What dependencies, services, or setup is required to work on this?"

**Instructions to show user:**
"List everything needed to work on this task:
- Required services (backend, frontend, database, etc.)
- Environment setup (local, dev, staging)
- External dependencies or APIs
- Reference documentation
- Configuration required

Example:
'Required:
- Paperclips backend server (refer to Quick Start Guide for setup)
- Paperclips frontend server (dev mode)
- Local PostgreSQL database
- Auth0 test account (credentials in 1Password)
See: /docs/DEVELOPMENT.md for full setup instructions'"

Store the dependencies and setup information.

Update the spec's "Dependencies & Setup" section with this information.

---

## Step 7: Update Linear Ticket

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] Dependencies documented (Step 6 complete)
- [ ] All sections complete: Description, Implementation Approach, Testing, Dependencies, Success Criteria
- [ ] Spec is ready for Linear

Update the Linear ticket with the enhanced spec:

Use the Linear MCP tool (mcp__plugin_linear_linear__update_issue):

**Format the enhanced spec for Linear:**
```markdown
[Original title from ticket]

## Description
[Original description + Council's insights]

## Implementation Approach
[Council's recommended approach from Step 2]

## Testing Strategy
[Testing strategy from Step 5]

## Dependencies & Setup
[Dependencies from Step 6]

## Success Criteria
[Success criteria generated during spec building]

---
*Enhanced by SpecCreator skill - AI-consumable specification*
*Validated by SpecCritique - Zero HIGH severity issues*
```

**Update the Linear issue:**
```
mcp__plugin_linear_linear__update_issue
{
  "id": "[ticket-id from input]",
  "description": "[enhanced spec from above]"
}
```

Store the updated Linear ticket ID and URL.

---

## Step 7.5: Multi-Repo Ticket Splitting (Optional)

⚠️ **CHECKPOINT: Before proceeding, confirm:**
- [ ] Linear ticket updated (Step 7 complete)
- [ ] Ticket ID and URL stored
- [ ] Ready to analyze if splitting is needed

**This step runs ONLY if the feature touches multiple repositories.**

### 7.5.1: Detect Multi-Repo Features

Ask the user:

**Question:** "Does this feature touch multiple repositories (e.g., backend + frontend)?"

**Options:**
1. **Yes - split into multiple tickets** - Feature spans repos, create separate tickets per repo
2. **No - keep as single ticket** - Feature is contained in one repo, skip splitting

**If user selects "No":** Skip to Step 8 (Output Summary)

**If user selects "Yes":** Continue to Step 7.5.2

### 7.5.2: Identify Affected Repositories

Use AskUserQuestion:

**Question:** "Which repositories does this feature touch? List all repositories affected."

**Instructions:**
"Provide repository names and what changes in each:
- Repository name (e.g., paper-clips-backend, paper-clips.net)
- What changes in that repo (e.g., 'API endpoints and database', 'UI components and pages')

Example:
'paper-clips-backend: API endpoints, database schema, business logic
paper-clips.net: verification page, banner component, settings gating'"

Store the repository list and change descriptions.

### 7.5.3: Split Specification by Repository

For each repository identified:

1. **Create repo-specific ticket:**
   - Clone the original ticket spec
   - Update title to include repo scope: "[Original Title] (BACKEND)" or "[Original Title] (FRONTEND)"
   - Add header: `**Repo:** [repo-name]`
   - Remove sections not relevant to this repo
   - Keep only implementation details for this repo's changes

2. **Add Ownership Boundaries section** (insert after Description):

```markdown
## Ownership Boundaries

**Contract Boundary:**

Backend publishes OpenAPI spec via `@hono/zod-openapi` (served at `/openapi.json`). Frontend consumes this spec for TypeScript type generation. The OpenAPI spec is the single integration contract between repos.

### [Backend/Frontend] Owns

| Domain | Description |
|--------|-------------|
| [Domain 1] | [What this repo owns for this domain] |
| [Domain 2] | [What this repo owns for this domain] |
| ... | ... |

### Does NOT Own

| Domain | Owner | Consumption Pattern |
|--------|-------|---------------------|
| [Domain 1] | [Other repo ticket ID] | [How to consume: API, types, etc.] |
| [Domain 2] | [Other repo ticket ID] | [How to consume] |
| ... | ... | ... |

### Overlap Prevention Rules

1. [Backend/Frontend]-specific rule about enforcement vs display
2. [Backend/Frontend]-specific rule about source of truth
3. [Additional repo-specific rules]
```

**Backend Ownership Table Template:**
- API Contract (OpenAPI spec)
- Database Schema
- Business Rules (tier limits, validation)
- Feature Gating Logic (enforcement)
- Token Lifecycle (generation, validation)
- Email Delivery
- Rate Limiting Rules (enforcement)
- Type Definitions (Zod schemas)

**Frontend Ownership Table Template:**
- UI Components (banners, modals, forms)
- Page Routes (new pages, route guards)
- UX Behavior (dismissal, interactions)
- Client State Management (session, localStorage)
- Display Logic (conditional rendering)
- Navigation Guards (defense-in-depth)
- Post-Action State Updates (after API calls)

3. **Cross-reference related tickets:**
   - Add `**Related:**` header pointing to other repo tickets
   - Example: `**Related:** See BRE-180 for frontend implementation and API consumption`

### 7.5.4: Create Repo-Specific Tickets in Linear

For each repo-specific spec created:

1. **Create Linear ticket:**
   ```
   mcp__plugin_linear_linear__create_issue
   {
     "team": "[team]",
     "title": "[Title with repo scope]",
     "description": "[Repo-specific spec with ownership boundaries]",
     "state": "[Todo or specified state]",
     "priority": "[priority]"
   }
   ```

2. **Store ticket ID and URL** for cross-referencing

### 7.5.5: Link Tickets with Relations

After all repo tickets are created:

1. **Update each ticket with relatedTo:**
   ```
   mcp__plugin_linear_linear__update_issue
   {
     "id": "[ticket-id]",
     "relatedTo": ["[other-ticket-id-1]", "[other-ticket-id-2]"]
   }
   ```

2. **Verify relationships** - Confirm all tickets show "Related to [other-ticket]" in Linear UI

### 7.5.6: Archive or Update Original Ticket

**If original ticket was just updated (Step 7):**

Use AskUserQuestion:

**Question:** "The original unified ticket has been split into repo-specific tickets. What should we do with the original?"

**Options:**
1. **Archive it** - Keep split tickets only, archive the unified one
2. **Keep as parent** - Update with links to split tickets, use as coordination ticket
3. **Delete it** - Remove the unified ticket completely

Handle accordingly.

**Store final ticket IDs and URLs** for all created tickets.

---

## Step 8: Output Summary

Present a comprehensive summary to the user:

**If single ticket (no splitting):**

```
✅ **Linear Ticket Spec Enhanced Successfully**

**Ticket:** [Linear ticket ID and URL]

**What Changed:**
- ✓ Council research completed - implementation approach defined
- ✓ SpecCritique validation passed - zero HIGH severity issues
- ✓ Testing strategy documented
- ✓ Dependencies and setup requirements captured

**Summary:**

**Original Description**
- [What the ticket originally said]

**Implementation Approach (Council Recommendation)**
- [Key points from Council's approach]
- [Major technical decisions]
- [Tradeoffs considered]

**Testing Strategy**
- [How this will be tested]
- [Key test scenarios]

**Dependencies**
- [Required services/setup]

**Success Criteria**
- [What defines done]

**Next Steps:**
1. Review the enhanced spec at [URL]
2. Ready for implementation planning
3. Can proceed to BlindQA after code is written
```

**If multiple tickets (split in Step 7.5):**

```
✅ **Multi-Repo Feature Spec Enhanced Successfully**

**Original Ticket:** [ticket-id and URL] - kept as coordination ticket

**Split Tickets:**

**[Ticket ID] - [Title with repo scope]**
- Repository: [repo-name] (e.g., paper-clips-backend)
- URL: [URL]
- Scope: [What this repo owns]
- Related to: [Other ticket IDs]

**[Ticket ID] - [Title with repo scope]**
- Repository: [repo-name] (e.g., paper-clips.net)
- URL: [URL]
- Scope: [What this repo owns]
- Related to: [Other ticket IDs]

**Ownership Boundaries:**
- [Repo 1] owns: [List key domains]
- [Repo 2] owns: [List key domains]
- Contract boundary: [How repos integrate - e.g., OpenAPI spec]

**Cross-References:**
- All tickets linked with Linear relatedTo relationships
- Ownership boundaries documented in each ticket
- Zero overlapping ownership

**Next Steps:**
1. Review all tickets: [URLs]
2. Backend ticket should be implemented first (publishes contract)
3. Frontend ticket can proceed once backend API is available
4. Assign tickets to appropriate team members
5. Add to sprint/milestone if needed
```

---

## Complete

Spec enhancement workflow complete. The Linear ticket now contains:
- ✓ Council-researched implementation approach
- ✓ SpecCritique-validated spec (zero HIGH severity issues)
- ✓ Comprehensive testing strategy
- ✓ Dependencies and setup requirements
- ✓ Multi-repo ownership boundaries (if applicable)

The spec is ready for implementation planning and coding. After code is written, use BlindQA for final verification.
