# Feature Specification: PM Workflow in Slack (MVP Core)

**Feature Branch**: `001-pm-workflow-slack`
**Created**: 2026-02-14
**Status**: Draft
**Input**: User description: "MVP Core: PM Workflow in Slack (Backend + Slack Plugin)"
**Linear Ticket**: BRE-181

## User Scenarios & Testing *(mandatory)*

### User Story 1 - PM Initiates Spec Creation (Priority: P1)

A Product Manager wants to create a feature specification by describing it in Slack. They invoke a command, provide a description, and the system creates a dedicated coordination channel with their selected team members.

**Why this priority**: This is the entry point for the entire workflow. Without the ability to initiate spec creation and assemble the team, no other functionality can be used. It delivers immediate value by eliminating the need to manually create channels and invite team members.

**Independent Test**: Can be fully tested by running `/specfactory` in any Slack channel, providing a feature description, selecting team roles/members, and confirming a coordination channel is created with all selected members invited.

**Acceptance Scenarios**:

1. **Given** PM is in any Slack channel, **When** they type `/specfactory`, **Then** bot prompts for feature description
2. **Given** PM enters feature description, **When** description is submitted, **Then** bot analyzes and determines needed roles
3. **Given** bot suggests 5 channel names, **When** PM selects one or enters custom name, **Then** channel name is confirmed
4. **Given** bot prompts for team members per role sequentially, **When** PM provides members for each role, **Then** all members are recorded
5. **Given** all team members selected, **When** PM confirms, **Then** coordination channel is created and all team members are invited
6. **Given** coordination channel created, **When** PM joins channel, **Then** they see welcome message and spec creation has begun

---

### User Story 2 - PM Participates in Blind QA (Priority: P1)

After channel creation, the system automatically starts asking clarifying questions about the feature using Slack's interactive components. The number of questions adapts to feature complexity, and the PM can select from multiple choices or provide custom answers.

**Why this priority**: This is the core value proposition of SpecFactory - intelligent, adaptive questioning that helps PMs think through their requirements. Without this, it's just a channel creation tool. This must work correctly for MVP.

**Independent Test**: Can be fully tested by completing User Story 1, then verifying questions appear in the coordination channel using Slack Block Kit UI, answers can be selected via radio buttons, "Other" option accepts custom text, and questions continue until spec is complete.

**Acceptance Scenarios**:

1. **Given** coordination channel created, **When** Blind QA starts, **Then** first question appears using Slack Block Kit UI
2. **Given** question displayed, **When** PM selects a radio button option, **Then** answer is recorded and next question appears
3. **Given** question displayed with "Other" option, **When** PM selects "Other" and enters custom text, **Then** custom answer is recorded
4. **Given** feature is complex, **When** AI analyzes responses, **Then** more questions are generated dynamically
5. **Given** feature is simple, **When** AI analyzes responses, **Then** fewer questions are asked
6. **Given** all questions answered, **When** final answer submitted, **Then** Blind QA phase completes

---

### User Story 3 - PM Reviews Completed Spec (Priority: P2)

After all questions are answered, the system generates a formatted specification document, posts a completion summary to the channel, and provides a web link where the full spec can be viewed in a readable format.

**Why this priority**: This provides the deliverable output of the workflow. While important, the spec could theoretically be viewed in raw format during MVP testing, making the polished web view slightly lower priority than the core workflow.

**Independent Test**: Can be fully tested by completing User Story 2, then verifying a completion summary is posted to the Slack channel, summary includes a shareable link, link opens to `https://specfactory.app/spec/{ID}`, and the spec is displayed in formatted HTML.

**Acceptance Scenarios**:

1. **Given** all Blind QA questions answered, **When** spec generation completes, **Then** completion summary is posted to coordination channel
2. **Given** completion summary posted, **When** PM views message, **Then** summary includes link to web-viewable spec
3. **Given** spec link provided, **When** PM clicks link, **Then** browser opens to `https://specfactory.app/spec/{ID}`
4. **Given** spec page loaded, **When** PM views page, **Then** formatted spec is displayed in HTML with proper styling
5. **Given** spec link, **When** PM shares link with stakeholders, **Then** stakeholders can view spec without authentication

---

### Edge Cases

- What happens when PM provides a feature description that's too vague (< 10 words)? System prompts for more detail
- How does system handle if PM abandons the workflow mid-question? Session persists for 24 hours, can resume
- What happens when channel name already exists? System appends number (e.g., "payments-v2")
- How does system handle if selected team member is not in workspace? System warns and allows substitution
- What happens when multiple PMs run `/specfactory` simultaneously? Each gets independent session and channel
- How does system handle network errors during Slack API calls? Retry with exponential backoff, notify PM if fails after 3 attempts
- What happens when web endpoint receives request for non-existent spec ID? Returns 404 with friendly error message

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST accept `/specfactory` command in any Slack channel without configuration
- **FR-002**: System MUST prompt for variable-length feature description via Slack modal or message
- **FR-003**: System MUST analyze feature description using LLM integration to determine needed roles
- **FR-004**: System MUST generate exactly 5 channel name suggestions using Blind QA pattern
- **FR-005**: System MUST allow PM to select from suggestions OR enter custom channel name
- **FR-006**: System MUST prompt sequentially for team members for each determined role
- **FR-007**: System MUST create Slack channel with PM-selected or PM-provided name
- **FR-008**: System MUST invite all selected team members to coordination channel
- **FR-009**: System MUST automatically start Blind QA questioning immediately after channel creation
- **FR-010**: System MUST render questions using Slack Block Kit interactive components (radio buttons, text inputs)
- **FR-011**: System MUST dynamically determine question count based on feature complexity via AI analysis
- **FR-012**: System MUST support multiple choice answers with working "Other" option for custom input
- **FR-013**: System MUST persist spec state and answers in database throughout workflow
- **FR-014**: System MUST post completion summary to coordination channel when all questions answered
- **FR-015**: System MUST generate unique spec ID and provide web-accessible link
- **FR-016**: System MUST serve formatted spec as HTML at `https://specfactory.app/spec/{ID}`
- **FR-017**: System MUST render spec with proper formatting, sections, and styling in web view
- **FR-018**: System MUST complete entire workflow without requiring Jira or Linear integration
- **FR-019**: System MUST handle Slack OAuth authentication for bot permissions
- **FR-020**: System MUST use Express + TypeScript for backend implementation
- **FR-021**: System MUST define and follow JSON protocol schemas for plugin communication

### Key Entities

- **Spec**: Represents a feature specification with unique ID, state (in-progress, completed), questions asked, answers provided, generated content, creation timestamp, and associated PM/team members
- **Channel**: Represents a Slack coordination channel with name, channel ID, invited members, and link to associated spec
- **Role**: Represents a team role determined by AI (e.g., "Backend Developer", "Frontend Developer", "Designer") with list of assigned team members
- **Question**: Represents a Blind QA question with question text, answer options, selected answer, custom text (if "Other"), and sequence order
- **Session**: Represents an active spec creation workflow with PM user ID, current state/step, timeout timestamp, and resume capability

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: PM completes full spec creation workflow in less than 30 minutes from command invocation to viewing completed spec
- **SC-002**: Workflow completes with zero errors (no failed API calls, no missing data, no UI breakage)
- **SC-003**: All 13 acceptance criteria from Linear ticket BRE-181 are verifiable and pass testing
- **SC-004**: Blind QA generates between 5-20 questions per spec based on complexity (simple features: ~5 questions, complex: ~20)
- **SC-005**: Channel name suggestions are relevant to feature description with at least 3 out of 5 rated as "good" by PM
- **SC-006**: Interactive Slack Block Kit components render correctly and accept user input without errors
- **SC-007**: Web-viewable spec loads in under 3 seconds and displays formatted content correctly
- **SC-008**: Spec state persists correctly with 100% answer accuracy (no data loss between questions)
- **SC-009**: System handles concurrent spec creation sessions without conflicts or data mixing

## Assumptions

- Slack workspace exists and bot app can be installed with necessary OAuth permissions (channels:manage, channels:write, chat:write, commands, users:read)
- PM has permission to create channels and invite members in the Slack workspace
- LLM API access is available for Blind QA question generation and complexity analysis (OpenAI, Anthropic, or similar)
- Database is available for persisting spec state (PostgreSQL, MongoDB, or similar - technology unspecified)
- Domain `specfactory.app` is available for web endpoint hosting
- SSL/HTTPS is configured for web endpoint
- Feature descriptions are provided in English
- Typical feature complexity ranges from simple (CRUD operations) to complex (multi-system integrations)
- PM is familiar with basic Slack commands and interactive components

## Out of Scope

The following are explicitly NOT part of this MVP (deferred to later phases):

- **Phase 3**: Jira/Linear ticket integration for automatic issue creation
- **Phase 4**: Production deployment, scaling, monitoring, and DevOps infrastructure
- **Analytics**: Usage tracking, completion metrics, or reporting dashboards
- **Multi-language support**: Non-English feature descriptions
- **Spec editing**: Ability to modify spec after completion
- **Spec versioning**: Multiple versions of same spec
- **Role templates**: Pre-defined role sets for common project types
- **Team member suggestions**: AI-powered team member recommendations based on past projects
- **Custom branding**: White-label or custom styling for web view
- **Export formats**: PDF, DOCX, or other downloadable formats
- **Authentication**: Login requirement for viewing specs (all specs publicly accessible via link)
