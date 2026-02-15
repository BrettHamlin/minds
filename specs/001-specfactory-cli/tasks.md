# Tasks: CLI Plugin for SpecFactory

**Input**: Design documents from `/specs/001-specfactory-cli/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md, contracts/specfactory-api.yaml

**Tests**: Tests are included per the TDD imperative. Contract tests validate CLI requests match the OpenAPI spec. Integration tests validate end-to-end workflow.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **CLI plugin**: `cli/src/`, `cli/tests/` (new directory)
- **Backend modifications**: `src/` at repository root (existing)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create cli/ directory structure, initialize Node.js/TypeScript project, install dependencies

- [X] T001 Create cli/ directory structure with src/ and tests/contract/, tests/integration/, tests/unit/ subdirectories per plan.md
- [X] T002 Initialize Node.js project with `package.json` in `cli/package.json` (name: @relay/specfactory-cli, type: module, bin entry)
- [X] T003 [P] Configure TypeScript in `cli/tsconfig.json` (target ES2022, module NodeNext, strict mode, outDir dist/)
- [X] T004 [P] Configure Vitest in `cli/vitest.config.ts` with test directory mappings
- [X] T005 Install dependencies: @clack/prompts, node-fetch, commander in `cli/package.json`
- [X] T006 Install dev dependencies: vitest, typescript, @types/node in `cli/package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend modifications required for CLI plugin mode. MUST be complete before ANY user story implementation.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T007 Add PLUGIN_TYPE environment variable logic (cli/slack/both) to `src/index.ts` -- skip Slack Bolt initialization when PLUGIN_TYPE=cli
- [X] T008 Modify `src/routes/specfactory.ts` POST /channel endpoint to check PLUGIN_TYPE and skip Slack channel creation, member invitation, and welcome message when PLUGIN_TYPE=cli
- [X] T009 [P] Update `src/services/channel.ts` to accept skipSlack parameter -- record channel metadata in database without calling Slack API
- [X] T010 [P] Add PLUGIN_TYPE to environment configuration validation in `src/index.ts` (default: "both" for backward compatibility)

**Checkpoint**: Backend runs in CLI mode (PLUGIN_TYPE=cli) without Slack SDK initialization. All existing Slack flows still work when PLUGIN_TYPE=slack or PLUGIN_TYPE=both.

---

## Phase 3: User Story 1 - Backend Developer Tests SpecFactory Locally (Priority: P1) MVP

**Goal**: Developer can run CLI command with a feature description and complete the full SpecFactory workflow (start, describe, analyze, select channel, QA loop, completion) entirely in the terminal.

**Independent Test**: `PLUGIN_TYPE=cli bun run cli/src/index.ts` starts interactive workflow, accepts description, shows channel suggestions, answers questions, and displays spec ID at completion.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T011 [P] [US1] Contract test: POST /start request matches StartSessionRequest schema with CLI pmUserId format in `cli/tests/contract/start-session.test.ts`
- [X] T012 [P] [US1] Contract test: POST /analyze request matches AnalyzeRequest schema in `cli/tests/contract/analyze.test.ts`
- [X] T013 [P] [US1] Contract test: POST /channel-names request matches ChannelNamesRequest schema in `cli/tests/contract/channel-names.test.ts`
- [X] T014 [P] [US1] Contract test: POST /channel request matches ChannelSelectRequest schema with empty member arrays in `cli/tests/contract/channel-select.test.ts`
- [X] T015 [P] [US1] Contract test: POST /questions/next request matches NextQuestionRequest schema in `cli/tests/contract/questions-next.test.ts`
- [X] T016 [P] [US1] Contract test: POST /questions/answer request matches SubmitAnswerRequest schema for both selectedOptionIndex and customText in `cli/tests/contract/questions-answer.test.ts`
- [X] T017 [P] [US1] Unit test: session ID generation produces format cli-{username}-{epoch} within varchar(64) in `cli/tests/unit/session.test.ts`
- [X] T018 [P] [US1] Unit test: exponential backoff calculates correct delays (1s, 2s, 4s) and retries only transient errors (429, 500, 502-504) in `cli/tests/unit/retry.test.ts`

### Implementation for User Story 1

- [X] T019 [P] [US1] Implement session ID generation (cli-{username}-{epoch_seconds} from os.userInfo) in `cli/src/session.ts`
- [X] T020 [P] [US1] Implement exponential backoff retry logic (1s/2s/4s delays, max 3 attempts, transient-only: 429/500/502-504/ECONNREFUSED) in `cli/src/retry.ts`
- [X] T021 [US1] Implement HTTP client with retry integration, 60s timeout for LLM endpoints, 10s for others, backend URL resolution (flag > env > default) in `cli/src/client.ts`
- [X] T022 [US1] Implement client method: startSession(pmUserId, slackChannelId) calling POST /api/specfactory/start in `cli/src/client.ts`
- [X] T023 [US1] Implement client method: analyzeDescription(specId, pmUserId, description) calling POST /api/specfactory/analyze in `cli/src/client.ts`
- [X] T024 [US1] Implement client method: getChannelNames(specId) calling POST /api/specfactory/channel-names in `cli/src/client.ts`
- [X] T025 [US1] Implement client method: selectChannel(specId, channelName, roles) calling POST /api/specfactory/channel in `cli/src/client.ts`
- [X] T026 [US1] Implement client method: getNextQuestion(specId) calling POST /api/specfactory/questions/next in `cli/src/client.ts`
- [X] T027 [US1] Implement client method: submitAnswer(specId, questionId, selectedOptionIndex?, customText?) calling POST /api/specfactory/questions/answer in `cli/src/client.ts`
- [X] T028 [US1] Implement client method: healthCheck() calling GET /health in `cli/src/client.ts`
- [X] T029 [US1] Implement terminal prompt: feature description input (multi-line, 10-word minimum validation) using @clack/prompts in `cli/src/prompts.ts`
- [X] T030 [US1] Implement terminal prompt: channel name selection (display 5 suggestions with rationale, numeric choice 1-5) using @clack/prompts in `cli/src/prompts.ts`
- [X] T031 [US1] Implement terminal prompt: QA question display with multiple-choice options (numeric selection) using @clack/prompts in `cli/src/prompts.ts`
- [X] T032 [US1] Implement terminal prompt: completion summary display (spec ID, view URL, question count) using @clack/prompts in `cli/src/prompts.ts`
- [X] T033 [US1] Implement terminal prompt: error display with retry option for transient failures using @clack/prompts in `cli/src/prompts.ts`
- [X] T034 [US1] Implement CLI entrypoint with commander setup (--backend-url, --no-slack, --help, --version flags) in `cli/src/index.ts`
- [X] T035 [US1] Implement main workflow orchestration: health check, start session, prompt description, analyze, get channel names, select channel, QA loop, completion in `cli/src/index.ts`
- [X] T036 [US1] Add Ctrl+C (SIGINT) handler for clean session interruption without corrupting state in `cli/src/index.ts`
- [X] T037 [US1] Add client-side input validation: description word count (10+), channel name format (^[a-z0-9][a-z0-9-]{0,79}$), option index range in `cli/src/prompts.ts`

**Checkpoint**: Developer can run `bun run cli/src/index.ts` and complete the full SpecFactory workflow interactively in the terminal. All contract tests pass.

---

## Phase 4: User Story 2 - Developer Runs Automated API Tests (Priority: P2)

**Goal**: Developer can execute CLI in JSON mode with --json flag, pipe input via stdin, use --auto-answer for unattended execution, and get structured output with exit codes for test automation.

**Independent Test**: `echo "Build a user auth system with email login and password reset and OAuth support" | bun run cli/src/index.ts --json --auto-answer` produces valid JSON envelope output and exits with code 0.

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T038 [P] [US2] Unit test: JSON envelope formatter produces correct schema with status/data/error/meta fields in `cli/tests/unit/output.test.ts`
- [X] T039 [P] [US2] Unit test: JSON envelope includes retryable flag and duration_ms in meta in `cli/tests/unit/output.test.ts`
- [X] T040 [P] [US2] Unit test: exit code returns 0 for success and non-zero for failures in `cli/tests/unit/output.test.ts`

### Implementation for User Story 2

- [X] T041 [US2] Implement JSON envelope formatter (status: success/error, data/error object, meta: timestamp/duration_ms/backend_url) in `cli/src/output.ts`
- [X] T042 [US2] Implement success envelope with phase-specific result shapes mirroring backend API responses in `cli/src/output.ts`
- [X] T043 [US2] Implement error envelope with retryable flag and structured error details in `cli/src/output.ts`
- [X] T044 [US2] Add --json flag to commander setup in `cli/src/index.ts` -- sets outputMode to json
- [X] T045 [US2] Add --auto-answer flag to commander setup in `cli/src/index.ts` -- selects first option automatically at every choice point
- [X] T046 [US2] Implement stdin input handling: detect piped input, read description from stdin when not TTY in `cli/src/index.ts`
- [X] T047 [US2] Wire JSON output mode through workflow: suppress @clack/prompts UI, emit JSON envelopes to stdout in `cli/src/index.ts`
- [X] T048 [US2] Implement exit code logic: 0=success, 1=user error, 2=backend error, 3=network error in `cli/src/index.ts`

**Checkpoint**: `echo "description" | bun run cli/src/index.ts --json --auto-answer` produces valid JSON output, exits with code 0, and output is parseable by jq.

---

## Phase 5: User Story 3 - Developer Completes Full QA Workflow (Priority: P3)

**Goal**: Developer can iterate through all Blind QA questions, including selecting "Other" with custom text input, and receive completion confirmation with spec ID and view URL.

**Independent Test**: Developer runs CLI, advances past channel selection, answers all questions (including at least one "Other" with custom text), and receives spec completion message.

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T049 [P] [US3] Unit test: "Other" option detection identifies last option as custom text trigger in `cli/tests/unit/prompts.test.ts`
- [X] T050 [P] [US3] Unit test: QA loop correctly handles type:"complete" response and exits loop in `cli/tests/unit/prompts.test.ts`

### Implementation for User Story 3

- [X] T051 [US3] Implement "Other" option detection in QA prompt: when last option selected, show text input for custom answer in `cli/src/prompts.ts`
- [X] T052 [US3] Implement QA loop completion detection: check type:"complete" from POST /questions/next and isComplete:true from POST /questions/answer in `cli/src/index.ts`
- [X] T053 [US3] Implement progress display during QA loop: show "Question X of Y" with progress bar using @clack/prompts spinner in `cli/src/prompts.ts`
- [X] T054 [US3] Wire custom text answer through submitAnswer client method (customText field instead of selectedOptionIndex) in `cli/src/index.ts`

**Checkpoint**: Developer can complete full QA workflow including "Other" custom answers. Completion shows spec ID and view URL.

---

## Phase 6: User Story 4 - Developer Isolates Backend Bugs (Priority: P4)

**Goal**: Developer can use --verbose flag to see request/response details for debugging, get clear error messages for all failure scenarios, and reproduce any SpecFactory workflow scenario.

**Independent Test**: Developer runs `bun run cli/src/index.ts --verbose` and sees HTTP method, URL, request body, response status, and response body for every API call.

### Tests for User Story 4

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T055 [P] [US4] Unit test: verbose logger formats request/response details (method, URL, status, body truncation) in `cli/tests/unit/client.test.ts`
- [X] T056 [P] [US4] Unit test: error messages map all ErrorResponse codes to human-readable messages in `cli/tests/unit/client.test.ts`

### Implementation for User Story 4

- [X] T057 [US4] Add --verbose flag to commander setup in `cli/src/index.ts` -- enables request/response logging
- [X] T058 [US4] Implement verbose request logging in HTTP client: log method, URL, headers, request body (truncated at 500 chars) in `cli/src/client.ts`
- [X] T059 [US4] Implement verbose response logging in HTTP client: log status code, response time, response body (truncated at 500 chars) in `cli/src/client.ts`
- [X] T060 [US4] Implement error message formatting: map all ErrorResponse.code values (MISSING_REQUIRED_FIELDS, INVALID_UUID, DESCRIPTION_TOO_SHORT, ACTIVE_SESSION_EXISTS, SPEC_NOT_FOUND, LLM_ERROR, INVALID_CHANNEL_NAME, INVALID_OPTION_INDEX) to clear terminal messages in `cli/src/client.ts`
- [X] T061 [US4] Implement 409 ACTIVE_SESSION_EXISTS handling: display existing spec ID and suggest resolution in `cli/src/prompts.ts`

**Checkpoint**: Developer can reproduce any workflow scenario with --verbose flag and see full HTTP traffic. All error codes produce clear, actionable terminal messages.

---

## Phase 7: Polish and Cross-Cutting Concerns

**Purpose**: Documentation, scripts, and validation across all user stories

- [X] T062 [P] Add CLI usage documentation in `cli/README.md` covering: installation, quickstart, flags (--backend-url, --json, --auto-answer, --no-slack, --verbose), environment variables, examples
- [X] T063 [P] Add npm scripts to `cli/package.json`: start, build, test, test:contract, test:integration, test:unit, lint
- [X] T064 Validate quickstart flow per `specs/001-specfactory-cli/quickstart.md` -- end-to-end from clone to completed spec
- [X] T065 Add bin entry to `cli/package.json` for `specfactory` command and verify `bun run cli/src/index.ts --help` output

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies -- can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion -- BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) completion
- **User Story 2 (Phase 4)**: Depends on User Story 1 core implementation (T021-T035 minimum)
- **User Story 3 (Phase 5)**: Depends on User Story 1 QA loop (T026, T027, T031)
- **User Story 4 (Phase 6)**: Depends on User Story 1 HTTP client (T021-T028)
- **Polish (Phase 7)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) -- No dependencies on other stories
- **User Story 2 (P2)**: Extends US1 with JSON output and automation flags -- depends on US1 workflow orchestration being functional
- **User Story 3 (P3)**: Extends US1 QA loop with "Other" option and completion detection -- depends on US1 QA prompt implementation
- **User Story 4 (P4)**: Extends US1 HTTP client with verbose logging and error formatting -- depends on US1 client implementation

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Pure utilities (session.ts, retry.ts) before client (client.ts)
- Client methods before prompts (prompts.ts)
- Prompts before orchestration (index.ts)
- Core implementation before flag integration

### Parallel Opportunities

All tasks marked [P] within a phase can run in parallel:

- **Phase 1**: T003 (tsconfig) and T004 (vitest config) in parallel
- **Phase 2**: T009 (channel service) and T010 (env config) in parallel
- **Phase 3 Tests**: All contract tests (T011-T016) and all unit tests (T017-T018) in parallel
- **Phase 3 Implementation**: T019 (session) and T020 (retry) in parallel (no shared dependencies)
- **Phase 4 Tests**: T038, T039, T040 all in parallel
- **Phase 5 Tests**: T049 and T050 in parallel
- **Phase 6 Tests**: T055 and T056 in parallel
- **Phase 7**: T062 (README) and T063 (scripts) in parallel

### Task Dependency Graph

```
Phase 1: T001 --> T002 --> T003 [P]
                      +--> T004 [P]
                      +--> T005
                      +--> T006

Phase 2: T007 --> T008 --> T009 [P]
                      +--> T010 [P]

Phase 3 (US1):
  Tests:  T011-T018 [all P, run in parallel]
  Impl:   T019 [P] -+
          T020 [P] -+--> T021 --> T022-T028 (sequential client methods)
                              +--> T029-T033 (sequential prompts)
                                       +--> T034 --> T035 --> T036 --> T037

Phase 4 (US2):
  Tests:  T038-T040 [all P]
  Impl:   T041 --> T042 --> T043 --> T044 --> T045 --> T046 --> T047 --> T048

Phase 5 (US3):
  Tests:  T049-T050 [all P]
  Impl:   T051 --> T052 --> T053 --> T054

Phase 6 (US4):
  Tests:  T055-T056 [all P]
  Impl:   T057 --> T058 --> T059 --> T060 --> T061

Phase 7: T062 [P] + T063 [P] --> T064 --> T065
```

---

## Parallel Example: User Story 1 Tests

```bash
# Launch all contract tests for User Story 1 together (they test different endpoints, no shared state):
Task: T011 "Contract test: POST /start request schema" in cli/tests/contract/start-session.test.ts
Task: T012 "Contract test: POST /analyze request schema" in cli/tests/contract/analyze.test.ts
Task: T013 "Contract test: POST /channel-names request schema" in cli/tests/contract/channel-names.test.ts
Task: T014 "Contract test: POST /channel request schema" in cli/tests/contract/channel-select.test.ts
Task: T015 "Contract test: POST /questions/next request schema" in cli/tests/contract/questions-next.test.ts
Task: T016 "Contract test: POST /questions/answer request schema" in cli/tests/contract/questions-answer.test.ts

# Launch all unit tests for User Story 1 together (pure functions, no shared state):
Task: T017 "Unit test: session ID generation" in cli/tests/unit/session.test.ts
Task: T018 "Unit test: exponential backoff" in cli/tests/unit/retry.test.ts

# Launch parallel-safe implementation tasks:
Task: T019 "Session ID generation" in cli/src/session.ts
Task: T020 "Exponential backoff retry" in cli/src/retry.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T006)
2. Complete Phase 2: Foundational (T007-T010)
3. Complete Phase 3: User Story 1 Tests (T011-T018) -- RED phase
4. Complete Phase 3: User Story 1 Implementation (T019-T037) -- GREEN phase
5. **STOP and VALIDATE**: Run `PLUGIN_TYPE=cli bun run cli/src/index.ts` end-to-end
6. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational --> Foundation ready
2. Add User Story 1 --> Test independently --> Deploy/Demo (MVP)
3. Add User Story 2 --> Test independently --> Deploy/Demo (automation support)
4. Add User Story 3 --> Test independently --> Deploy/Demo (full QA)
5. Add User Story 4 --> Test independently --> Deploy/Demo (debugging)
6. Each story adds value without breaking previous stories

### Single Developer Strategy

With one developer (recommended order):

1. Complete Setup + Foundational (Phase 1-2)
2. User Story 1 (Phase 3) -- core workflow, must be solid
3. User Story 3 (Phase 5) -- QA completion, depends on US1 QA loop
4. User Story 2 (Phase 4) -- automation, extends US1 with flags
5. User Story 4 (Phase 6) -- debugging, lowest priority
6. Polish (Phase 7) -- documentation and validation

---

## Notes

- [P] tasks = different files, no dependencies, safe to run in parallel
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable after Phase 2
- Verify tests FAIL (RED) before implementing (GREEN)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Backend changes (Phase 2) are minimal: conditional Slack init only
- CLI is a pure HTTP client -- zero direct database access, zero LLM SDK usage
