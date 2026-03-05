---
description: Create or update the feature specification from a natural language feature description.
handoffs: 
  - label: Build Technical Plan
    agent: relay.plan
    prompt: Create a plan for the spec. I am building with...
  - label: Clarify Spec Requirements
    agent: relay.clarify
    prompt: Clarify specification requirements
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

The text the user typed after `/collab.specify` in the triggering message **is** the feature description. Assume you always have it available in this conversation even if `$ARGUMENTS` appears literally below. Do not ask the user to repeat it unless they provided an empty command.

**IMPORTANT**: If $ARGUMENTS matches the pattern `[A-Z]+-[0-9]+` (e.g., BRE-202, JIRA-456), it's a ticket ID. You MUST:
1. Fetch the ticket from Linear using `get_issue` with `includeRelations: true`
2. Extract the ticket title and description
3. Use the ticket ID and description for all subsequent steps
4. When calling create-new-feature.ts, prepend the ticket ID to the feature description so the script can extract it
5. **Pipeline variant detection**: Check the ticket's labels for any matching `pipeline:*` (e.g., `pipeline:backend`, `pipeline:ios`). If found, store the variant name (text after `pipeline:`) for later writing to metadata.json. If multiple `pipeline:*` labels are found, warn and use the first match.
6. **blockedBy extraction**: From the `get_issue` response (with `includeRelations: true`), extract the `blockedBy` relations. These are the ticket IDs that this ticket is blocked by. Store them for writing to metadata.json.

Given that feature description, do this:

1. **Generate a concise short name** (2-4 words) for the branch:
   - Analyze the feature description and extract the most meaningful keywords
   - Create a 2-4 word short name that captures the essence of the feature
   - Use action-noun format when possible (e.g., "add-user-auth", "fix-payment-bug")
   - Preserve technical terms and acronyms (OAuth2, API, JWT, etc.)
   - Keep it concise but descriptive enough to understand the feature at a glance
   - Examples:
     - "I want to add user authentication" → "user-auth"
     - "Implement OAuth2 integration for the API" → "oauth2-api-integration"
     - "Create a dashboard for analytics" → "analytics-dashboard"
     - "Fix payment processing timeout bug" → "fix-payment-timeout"

2. **Check for existing branches before creating new one**:

   a. First, fetch all remote branches to ensure we have the latest information:

      ```bash
      git fetch --all --prune
      ```

   b. Find the highest feature number across all sources for the short-name:
      - Remote branches: `git ls-remote --heads origin | grep -E 'refs/heads/[0-9]+-<short-name>$'`
      - Local branches: `git branch | grep -E '^[* ]*[0-9]+-<short-name>$'`
      - Specs directories: Check for directories matching `specs/[0-9]+-<short-name>`

   c. Determine the next available number:
      - Extract all numbers from all three sources
      - Find the highest number N
      - Use N+1 for the new branch number

   c.5. **Source Repo Detection**:
      - If `--source-repo` was passed, use it directly as `SOURCE_REPO`. Done.
      - Otherwise, if `--repo` was passed:
        ```bash
        SOURCE_REPO=$(collab repo resolve {repo_id})
        ```
        If exit 0, use the result. If exit 1, skip.
      - If no `--repo` was provided, skip.

   d. Run the script `.specify/scripts/create-new-feature.ts --json --worktree "$ARGUMENTS"` with the calculated number and short-name:
      - Pass `--number N+1` and `--short-name "your-short-name"` along with the feature description
      - **CRITICAL**: If the input was a ticket ID, prepend it to the feature description (e.g., "BRE-202 Build a tool that...") so the script's regex can extract it
      - **--worktree is mandatory** for orchestrator workflows to keep the orchestrator pane on the main branch
      - Optionally specify `--worktree-path <dir>` to override the default worktree location (default: `../worktrees/`)
      - If `SOURCE_REPO` was set in step c.5, add `--source-repo "$SOURCE_REPO"` to the command
      - Example: `.specify/scripts/create-new-feature.ts --json --worktree --number 5 --short-name "user-auth" "Add user authentication"`
      - Example with ticket: `.specify/scripts/create-new-feature.ts --json --worktree --number 5 --short-name "user-auth" "BRE-202 Add user authentication"`
      - Example with source repo: `.specify/scripts/create-new-feature.ts --json --worktree --number 3 --short-name "add-clips" --source-repo ~/Code/projects/paper-clips-backend "BRE-158 Add clips endpoint"`

   e. **Pipeline Variant and Dependency Metadata** (run after create-new-feature.ts completes):
      After create-new-feature.ts completes and outputs JSON with FEATURE_DIR, update the metadata.json:
      - Read `FEATURE_DIR/metadata.json`
      - If `--repo` was passed: add `"repo_id": "<repo>"` (e.g., `"repo_id": "paper-clips-backend"`). This tells orchestrator-init.ts which repo to use from multi-repo.json.
      - If ticket has `pipeline:*` labels (from step 5 above): add `"pipeline_variant": "<variant>"` (e.g., `"pipeline_variant": "backend"`). This tells orchestrator-init.ts to load `pipeline-variants/<variant>.json` instead of the default `pipeline.json`.
      - If ticket has `blockedBy` relations (from step 6 above): add `"blockedBy": ["BRE-XXX", ...]` (array of blocker ticket IDs). This enables orchestrator-init.ts to create dependency holds automatically.
      - Write the updated metadata.json back (only if at least one of the above fields was added).
      - If none of repo_id, pipeline_variant, or blockedBy applies, skip this step.

   **IMPORTANT**:
   - Check all three sources (remote branches, local branches, specs directories) to find the highest number
   - Only match branches/directories with the exact short-name pattern
   - If no existing branches/directories found with this short-name, start with number 1
   - You must only ever run this script once per feature
   - The JSON is provided in the terminal as output - always refer to it to get the actual content you're looking for
   - The JSON output will contain BRANCH_NAME, SPEC_FILE paths, and WORKTREE_DIR
   - For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot")

3. Load `.specify/templates/spec-template.md` to understand required sections.

4. Follow this execution flow:

    1. Parse user description from Input
       If empty: ERROR "No feature description provided"
    2. Extract key concepts from description
       Identify: actors, actions, data, constraints
    3. For unclear aspects:
       - Make informed guesses based on context and industry standards
       - Only mark with [NEEDS CLARIFICATION: specific question] if:
         - The choice significantly impacts feature scope or user experience
         - Multiple reasonable interpretations exist with different implications
         - No reasonable default exists
       - **LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers total**
       - Prioritize clarifications by impact: scope > security/privacy > user experience > technical details
    4. Fill User Scenarios & Testing section
       If no clear user flow: ERROR "Cannot determine user scenarios"
    5. Generate Functional Requirements
       Each requirement must be testable
       Use reasonable defaults for unspecified details (document assumptions in Assumptions section)
    6. Define Success Criteria
       Create measurable, technology-agnostic outcomes
       Include both quantitative metrics (time, performance, volume) and qualitative measures (user satisfaction, task completion)
       Each criterion must be verifiable without implementation details
    7. Identify Key Entities (if data involved)
    8. Return: SUCCESS (spec ready for planning)

5. Write the specification to SPEC_FILE using the template structure, replacing placeholders with concrete details derived from the feature description (arguments) while preserving section order and headings.

6. **Specification Quality Validation**: After writing the initial spec, validate it against quality criteria:

   a. **Create Spec Quality Checklist**: Generate a checklist file at `FEATURE_DIR/checklists/requirements.md` using the checklist template structure with these validation items:

      ```markdown
      # Specification Quality Checklist: [FEATURE NAME]
      
      **Purpose**: Validate specification completeness and quality before proceeding to planning
      **Created**: [DATE]
      **Feature**: [Link to spec.md]
      
      ## Content Quality
      
      - [ ] No implementation details (languages, frameworks, APIs)
      - [ ] Focused on user value and business needs
      - [ ] Written for non-technical stakeholders
      - [ ] All mandatory sections completed
      
      ## Requirement Completeness
      
      - [ ] No [NEEDS CLARIFICATION] markers remain
      - [ ] Requirements are testable and unambiguous
      - [ ] Success criteria are measurable
      - [ ] Success criteria are technology-agnostic (no implementation details)
      - [ ] All acceptance scenarios are defined
      - [ ] Edge cases are identified
      - [ ] Scope is clearly bounded
      - [ ] Dependencies and assumptions identified
      
      ## Feature Readiness
      
      - [ ] All functional requirements have clear acceptance criteria
      - [ ] User scenarios cover primary flows
      - [ ] Feature meets measurable outcomes defined in Success Criteria
      - [ ] No implementation details leak into specification
      
      ## Notes
      
      - Items marked incomplete require spec updates before `/collab.plan`
      ```

   b. **Run Validation Check**: Review the spec against each checklist item:
      - For each item, determine if it passes or fails
      - Document specific issues found (quote relevant spec sections)

   c. **Handle Validation Results**:

      - **If all items pass**: Mark checklist complete and proceed to step 6

      - **If items fail (excluding [NEEDS CLARIFICATION])**:
        1. List the failing items and specific issues
        2. Update the spec to address each issue
        3. Re-run validation until all items pass (max 3 iterations)
        4. If still failing after 3 iterations, document remaining issues in checklist notes and warn user

      - **If [NEEDS CLARIFICATION] markers remain**:
        1. Extract all [NEEDS CLARIFICATION: ...] markers from the spec
        2. For each marker, make an informed guess based on:
           - Context from the feature description
           - Industry standards and common patterns
           - Best practices for the domain
           - The most reasonable default that reduces downstream rework
        3. Replace each [NEEDS CLARIFICATION] marker with the chosen answer
        4. Document the resolved decisions in the spec's Assumptions section
        5. Re-run validation to confirm all markers are resolved

   d. **Update Checklist**: After each validation iteration, update the checklist file with current pass/fail status

7. Report completion with branch name, spec file path, checklist results, and readiness for the next phase (`/collab.plan`).

**NOTE:** The script creates a git worktree and initializes the spec file before writing. The spec is created inside the worktree directory and the JSON output includes `WORKTREE_DIR` for reference. **Do NOT change directory** — stay in the main repo so you can run `/collab.run` as the orchestrator. The agent pane will automatically spawn in the worktree.

## General Guidelines

## Quick Guidelines

- Focus on **WHAT** users need and **WHY**.
- Avoid HOW to implement (no tech stack, APIs, code structure).
- Written for business stakeholders, not developers.
- DO NOT create any checklists that are embedded in the spec. That will be a separate command.

### Section Requirements

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation

When creating this spec from a user prompt:

1. **Make informed guesses**: Use context, industry standards, and common patterns to fill gaps
2. **Document assumptions**: Record reasonable defaults in the Assumptions section
3. **Limit clarifications**: Maximum 3 [NEEDS CLARIFICATION] markers - use only for critical decisions that:
   - Significantly impact feature scope or user experience
   - Have multiple reasonable interpretations with different implications
   - Lack any reasonable default
4. **Prioritize clarifications**: scope > security/privacy > user experience > technical details
5. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
6. **Common areas needing clarification** (only if no reasonable default exists):
   - Feature scope and boundaries (include/exclude specific use cases)
   - User types and permissions (if multiple conflicting interpretations possible)
   - Security/compliance requirements (when legally/financially significant)

**Examples of reasonable defaults** (don't ask about these):

- Data retention: Industry-standard practices for the domain
- Performance targets: Standard web/mobile app expectations unless specified
- Error handling: User-friendly messages with appropriate fallbacks
- Authentication method: Standard session-based or OAuth2 for web apps
- Integration patterns: RESTful APIs unless specified otherwise

### Success Criteria Guidelines

Success criteria must be:

1. **Measurable**: Include specific metrics (time, percentage, count, rate)
2. **Technology-agnostic**: No mention of frameworks, languages, databases, or tools
3. **User-focused**: Describe outcomes from user/business perspective, not system internals
4. **Verifiable**: Can be tested/validated without knowing implementation details

**Good examples**:

- "Users can complete checkout in under 3 minutes"
- "System supports 10,000 concurrent users"
- "95% of searches return results in under 1 second"
- "Task completion rate improves by 40%"

**Bad examples** (implementation-focused):

- "API response time is under 200ms" (too technical, use "Users see results instantly")
- "Database can handle 1000 TPS" (implementation detail, use user-facing metric)
- "React components render efficiently" (framework-specific)
- "Redis cache hit rate above 80%" (technology-specific)
