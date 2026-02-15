# Feature Specification: CLI Plugin for SpecFactory

**Feature Branch**: `001-specfactory-cli`
**Created**: 2026-02-14
**Status**: Draft
**Input**: User description: "CLI Plugin for SpecFactory (Backend Testing Without Slack)"

## Clarifications

### Session 2026-02-14

- Q: How should the CLI manage the OpenRouter API key for LLM operations? → A: Environment variable on backend only. CLI delegates all LLM calls to backend's llm.ts service, which reads OPENROUTER_API_KEY at server startup. CLI is a pure HTTP client with zero LLM knowledge.
- Q: How does the CLI discover/configure the backend URL? → A: Three-tier precedence: --backend-url flag (highest) > SPECFACTORY_BACKEND_URL environment variable > default http://localhost:3000 (lowest). Follows standard CLI patterns (kubectl, docker, gh).
- Q: What is the exact format for CLI session identifiers? → A: Format `cli-{username}-{epoch_seconds}` where username is from os.userInfo().username. Example: cli-atlas-1739520000. Fits varchar(64) constraint, human-readable, collision-free.
- Q: Should the CLI retry failed API calls or fail fast? → A: Retry transient errors (429, 500, 502-504, connection refused) with exponential backoff (1s, 2s, 4s, max 3 attempts). Fail fast on permanent errors (400, 404, 409). 60-second timeout for LLM endpoints.
- Q: What is the exact schema for --json mode output? → A: Envelope pattern with status (success/error) + data/error + meta fields. Phase-specific result shapes mirror backend API responses. Includes retryable flag and duration_ms for automation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Backend Developer Tests SpecFactory Locally (Priority: P1)

A backend developer wants to test the SpecFactory workflow end-to-end without configuring a Slack workspace. They need to verify that feature analysis, role determination, and question generation work correctly through direct CLI interactions.

**Why this priority**: This is the foundational capability that unblocks all backend development. Without it, developers cannot iterate on SpecFactory logic without Slack infrastructure.

**Independent Test**: Developer can run CLI command with a feature description and receive AI-generated channel name suggestions, completing the full analysis workflow in terminal.

**Acceptance Scenarios**:

1. **Given** developer has SpecFactory backend running locally, **When** they execute CLI command with feature description, **Then** system initiates session and prompts for input
2. **Given** developer enters feature description (10+ words), **When** system analyzes it, **Then** system displays 5 AI-generated channel names with rationale
3. **Given** developer selects a channel name suggestion, **When** system processes the selection, **Then** workflow advances to next phase without errors
4. **Given** developer encounters an error during workflow, **When** error occurs, **Then** system displays clear error message and allows retry

---

### User Story 2 - Developer Runs Automated API Tests (Priority: P2)

A backend developer wants to write automated tests for SpecFactory APIs without mocking Slack SDK calls. They need the CLI to be programmable so test scripts can drive the workflow via stdin/stdout.

**Why this priority**: Enables continuous integration testing and catches backend regressions before they reach Slack plugin. Critical for maintaining code quality.

**Independent Test**: Developer can execute CLI in JSON mode and parse structured output to verify API responses match expected schema.

**Acceptance Scenarios**:

1. **Given** developer runs CLI with `--json` flag, **When** workflow completes, **Then** output is valid JSON with spec ID and status
2. **Given** developer scripts CLI input via stdin, **When** workflow requires user response, **Then** CLI accepts piped input and continues
3. **Given** developer runs CLI in non-interactive mode with `--auto-answer`, **When** workflow presents choices, **Then** CLI selects first option automatically and completes
4. **Given** automated test fails, **When** CLI exits, **Then** exit code indicates failure (non-zero) for test framework detection

---

### User Story 3 - Developer Completes Full QA Workflow (Priority: P3)

A developer testing Blind QA question generation wants to iterate through all questions and provide answers via CLI, verifying the question engine generates relevant questions based on feature complexity.

**Why this priority**: Validates the most complex part of SpecFactory (question generation) in isolation, before involving Slack UI complexity.

**Independent Test**: Developer can answer all Blind QA questions sequentially in terminal and receive completion confirmation.

**Acceptance Scenarios**:

1. **Given** developer has advanced workflow past channel names, **When** system presents first Blind QA question, **Then** CLI displays question text with multiple choice options
2. **Given** developer selects "Other" option, **When** prompted for custom answer, **Then** CLI accepts text input and submits to backend
3. **Given** developer answers a question, **When** answer is submitted, **Then** CLI fetches next question automatically or shows completion message
4. **Given** developer completes all questions, **When** workflow finishes, **Then** CLI displays spec ID and view URL

---

### User Story 4 - Developer Isolates Backend Bugs (Priority: P4)

A developer debugging a SpecFactory issue wants to reproduce the problem without Slack to determine if it's a backend logic bug or Slack integration bug.

**Why this priority**: Reduces debugging time by eliminating variables. Non-critical for initial release but valuable for maintenance.

**Independent Test**: Developer can reproduce any SpecFactory workflow scenario via CLI commands and verify backend behavior matches expectations.

**Acceptance Scenarios**:

1. **Given** developer suspects backend bug in role determination, **When** they run CLI with specific feature description, **Then** CLI displays role analysis results for verification
2. **Given** developer needs to test session conflict handling, **When** they attempt duplicate session creation, **Then** CLI displays appropriate error (409 conflict)
3. **Given** developer tests validation logic, **When** they provide invalid input (e.g., short description), **Then** CLI displays validation error before making API call
4. **Given** developer runs workflow in verbose mode, **When** API calls execute, **Then** CLI logs request/response details for debugging

---

### Edge Cases

- What happens when backend server is not reachable (connection refused)?
- How does CLI handle incomplete workflows if user terminates mid-session (Ctrl+C)?
- What happens when user provides multi-line input with special characters or quotes?
- How does system handle extremely long feature descriptions (1000+ words)?
- What happens if LLM API calls timeout or rate limit is hit?
- How does CLI handle concurrent session attempts by same user?
- What happens when backend returns malformed JSON responses?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST initiate SpecFactory session via CLI command without Slack workspace configuration
- **FR-002**: System MUST accept feature descriptions of 10+ words via terminal prompt with multi-line input support
- **FR-003**: System MUST display AI-generated channel name suggestions with rationale in terminal
- **FR-004**: System MUST accept user selection via numeric choice (1-5) or custom name entry (option 6)
- **FR-005**: System MUST present Blind QA questions sequentially with multiple choice options
- **FR-006**: System MUST accept question answers via numeric selection or custom text input ("Other" option)
- **FR-007**: System MUST display completion summary with spec ID and view URL when workflow finishes
- **FR-008**: System MUST handle errors gracefully with clear messages and allow retry on transient failures
- **FR-009**: System MUST support JSON output mode via `--json` flag for programmatic parsing
- **FR-010**: System MUST support non-interactive mode via `--auto-answer` flag for automated testing
- **FR-011**: System MUST support `--no-slack` mode to skip Slack-specific operations (channel creation)
- **FR-012**: System MUST use identical REST API endpoints and payloads as Slack plugin
- **FR-013**: System MUST validate user input client-side before making API calls (e.g., description length)
- **FR-014**: System MUST reject duplicate session creation attempts with clear error message
- **FR-015**: System MUST exit with non-zero exit code on fatal errors for script detection
- **FR-016**: System MUST display help information via `--help` flag
- **FR-017**: System MUST display version information via `--version` flag
- **FR-018**: System MUST manage CLI session state using unique session identifier (not Slack user ID)
- **FR-019**: Backend MUST be configurable to run CLI plugin, Slack plugin, or both via `PLUGIN_TYPE` environment variable (`cli`, `slack`, or `both`). When `PLUGIN_TYPE=cli`, Slack Bolt initialization is skipped and channel operations record metadata only without creating actual Slack channels.
- **FR-020**: System MUST handle user interruption (Ctrl+C) cleanly without corrupting session state
- **FR-021**: System MUST resolve backend URL using three-tier precedence: `--backend-url` CLI flag > `SPECFACTORY_BACKEND_URL` environment variable > default `http://localhost:3000`
- **FR-022**: System MUST generate session identifiers using format `cli-{username}-{epoch_seconds}` where username comes from OS user info (e.g., `cli-atlas-1739520000`)
- **FR-023**: System MUST retry transient API errors (429, 500, 502-504, connection refused) with exponential backoff (1s, 2s, 4s base delays, maximum 3 attempts) and fail fast on permanent errors (400, 404, 409)
- **FR-024**: System MUST use 60-second timeout for LLM endpoints (`/analyze`, `/channel-names`, `/questions/answer`) and 10-second timeout for other endpoints
- **FR-025**: System MUST produce JSON output with envelope pattern containing `status` field (success/error), `data` or `error` object, and `meta` object with timestamp, duration_ms, and backend_url when `--json` flag is used

### Key Entities *(include if feature involves data)*

- **CLI Session**: Represents a single developer's SpecFactory workflow execution, identified by unique session ID with format `cli-{username}-{epoch_seconds}` (e.g., `cli-atlas-1739520000`). Session ID serves as `pmUserId` in backend API calls, enabling the same session uniqueness constraint as Slack plugin.
- **Workflow State**: Tracks current phase of SpecFactory process (awaiting_description, analyzing, selecting_channel, ready for CLI simplified flow; full Slack flow includes selecting_members, confirming, creating_channel)
- **User Response**: Captures developer's answers to questions and selections, submitted to backend APIs via REST endpoints
- **Configuration**: Backend URL resolved via three-tier precedence (CLI flag > environment variable > default localhost:3000). Backend requires `PLUGIN_TYPE` environment variable (`cli`/`slack`/`both`) to control Slack initialization. Backend's `OPENROUTER_API_KEY` used for all LLM operations (CLI never holds API key).
- **Retry State**: Transient error tracking for exponential backoff (maximum 3 attempts with 1s, 2s, 4s delays). Permanent errors (400, 404, 409) fail immediately without retry.
- **JSON Envelope**: When `--json` flag used, all output wrapped in envelope with `status`, `data`/`error`, and `meta` fields. Phase-specific result shapes mirror backend API responses.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developer can complete full SpecFactory workflow from initial description to completion in under 2 minutes without external dependencies
- **SC-002**: Backend features can be tested locally without Slack workspace, achieving 100% workflow coverage compared to Slack plugin
- **SC-003**: Test automation can verify backend behavior programmatically and detect failures reliably
- **SC-004**: Backend bugs can be isolated from integration issues, reducing average debugging time by 50%
- **SC-005**: New contributors can test SpecFactory locally within 5 minutes of cloning repository without external service configuration
- **SC-006**: System validates user input before processing, reducing failed operations by 30%
- **SC-007**: System provides clear error messages for all failure scenarios, eliminating "silent failures"
- **SC-008**: Developers can script workflow execution for automated testing with machine-readable output
- **SC-009**: Developer can reproduce any SpecFactory workflow scenario for bug verification without additional tools
- **SC-010**: System completes AI-powered analysis operations (feature analysis, suggestion generation) in under 60 seconds per operation

## Assumptions

- Backend SpecFactory APIs are already implemented and stable
- OpenRouter API key is available for LLM calls during testing
- PostgreSQL database is available locally or via Docker
- Developers are familiar with terminal/command-line interfaces
- Slack workspace configuration is considered a barrier to backend testing (not an unreasonable assumption)
- REST API protocol between plugins and backend is well-defined and documented
- Session management logic exists in backend and accepts custom session identifiers
- Backend can run without Slack SDK initialization in CLI-only mode

## Dependencies

- Existing SpecFactory backend APIs (`POST /api/specfactory/*`)
- OpenRouter LLM API for feature analysis and question generation
- PostgreSQL database for session and spec persistence
- Node.js runtime (v18+) for CLI execution
- Terminal prompt library (e.g., `@clack/prompts` for consistency with SpecKit)

## Out of Scope

- CLI-specific features not present in Slack plugin (custom file output, special formatting)
- Slack workspace management or configuration via CLI
- Real-time collaboration between multiple CLI users
- Visual spec rendering in terminal (use web endpoint for HTML view)
- Migration of existing Slack-created specs to CLI format
- CLI-driven Slack channel creation (Slack operations require Slack workspace)
