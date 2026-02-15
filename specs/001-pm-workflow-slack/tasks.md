# Tasks: PM Workflow in Slack (MVP Core)

**Input**: Design documents from `/specs/001-pm-workflow-slack/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/specfactory-api.yaml, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3) -- only on story-specific tasks
- Include exact file paths in descriptions

## Path Conventions

This project uses a single-project layout with `src/` at repository root:
- Schema: `src/db/schema.ts`
- Database client: `src/db/index.ts`
- Services: `src/services/`
- API routes: `src/routes/`
- Slack integration: `src/plugins/slack/`
- LLM integration: `src/services/llm.ts`
- Frontend: `frontend/src/pages/spec/[id].tsx`
- Tests: `tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependency installation, environment configuration, and build tooling.

- [X] T001 Install production dependencies (`drizzle-orm`, `openai`) and dev dependencies (`drizzle-kit`, `@vitest/coverage-v8`) per research.md -- run `npm install drizzle-orm openai && npm install -D drizzle-kit @vitest/coverage-v8`
- [X] T002 [P] Create `.env.example` with all required environment variables (PORT, DATABASE_URL, OPENROUTER_API_KEY, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN, SPEC_BASE_URL) per quickstart.md section 2 in `.env.example`
- [X] T003 [P] Create Drizzle Kit configuration file at `drizzle.config.ts` with schema path `./src/db/schema.ts`, output `./drizzle`, dialect `postgresql`, and `DATABASE_URL` from env per data-model.md Drizzle Configuration section
- [X] T004 [P] Create Vitest configuration file at `vitest.config.ts` with TypeScript path aliases matching `tsconfig.json`, coverage provider `v8`, and test file pattern `**/*.test.ts`
- [X] T005 [P] Create error types module at `src/lib/errors.ts` with custom error classes: `AppError` (base, with `code`, `statusCode`, `details`), `NotFoundError`, `ConflictError`, `ValidationError`, `LLMError` -- error codes must match ErrorResponse schema in contracts (e.g., SPEC_NOT_FOUND, ACTIVE_SESSION_EXISTS, CHANNEL_NAME_TAKEN, DESCRIPTION_TOO_SHORT)
- [X] T006 [P] Create input validation helpers at `src/lib/validation.ts` with functions: `validateUUID(id: string)`, `validateDescriptionLength(text: string, minWords: number)`, `validateSlackChannelName(name: string)` (pattern `^[a-z0-9][a-z0-9-]*$`, max 80 chars), `validateOptionIndex(index: number, optionsLength: number)`

**Checkpoint**: Project builds, tests run (empty), environment is configured.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented. This includes the full database schema, database client, Slack client initialization, and Express middleware.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T007 Implement full Drizzle ORM schema at `src/db/schema.ts` with all 7 tables (specs, channels, spec_roles, role_members, questions, answers, sessions), both enums (spec_state, session_step), all indexes, and all relations per data-model.md -- copy schema definitions and relations exactly as specified
- [X] T008 Implement database client at `src/db/index.ts` with `pg.Pool` connection (pool size 20 per SC-009), `drizzle()` initialization with schema import, and exported `db` instance and `Database` type per data-model.md Database Client Setup section
- [X] T009 Run initial database migration -- execute `npx drizzle-kit generate` then `npx drizzle-kit push` to create all 7 tables and verify with `psql $DATABASE_URL -c "\dt"` showing specs, channels, spec_roles, role_members, questions, answers, sessions
- [X] T010 [P] Initialize Slack Bolt app at `src/plugins/slack/client.ts` -- create and export Slack `App` instance using `@slack/bolt` with `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, and `SLACK_APP_TOKEN` from environment; enable Socket Mode for development
- [X] T011 [P] Create Express middleware at `src/routes/middleware.ts` with: JSON body parser, error handling middleware (catches `AppError` subclasses and returns `ErrorResponse` JSON format per API contract), request ID generation, and async route handler wrapper to catch promise rejections
- [X] T012 Update Express app entry point at `src/index.ts` -- import and register API route groups (`/api/specfactory/*`, `/api/spec/*`), apply middleware from T011, start Slack Bolt app alongside Express server, add health check endpoint at `/health` returning `{"status":"ok","service":"relay","version":"0.1.0"}`

**Checkpoint**: Foundation ready -- database has all tables, Slack bot connects, Express serves `/health`, error handling works. User story implementation can now begin in parallel.

---

## Phase 3: User Story 1 -- PM Initiates Spec Creation (Priority: P1)

**Goal**: PM types `/specfactory` in any Slack channel, provides a feature description, selects a channel name and team members, and a coordination channel is created with all members invited.

**Independent Test**: Run `/specfactory` in any Slack channel, provide a feature description, select team roles/members, and confirm a coordination channel is created with all selected members invited.

**Endpoints**: POST `/api/specfactory/start`, POST `/api/specfactory/analyze`, POST `/api/specfactory/channel-names`, POST `/api/specfactory/channel`

**Entities**: specs (basic fields), sessions, channels, spec_roles, role_members

### Services for User Story 1

- [X] T013 [P] [US1] Implement session service at `src/services/session.ts` with functions: `createSession(specId, pmUserId, slackChannelId)` -- creates session with 24h expiry and step `awaiting_description`; `getActiveSession(pmUserId)` -- finds active non-expired session with spec relation; `updateSessionStep(sessionId, step, metadata?)` -- transitions session step and refreshes `expiresAt` to NOW + 24h; `deactivateSession(sessionId)` -- sets `isActive` to false; include validation that step transitions follow the allowed sequence from data-model.md Session Step Transitions
- [X] T014 [P] [US1] Implement spec service at `src/services/spec.ts` with functions: `createSpec(title, description, pmUserId, pmDisplayName?)` -- inserts spec with state `drafting` and returns spec record; `updateSpecAnalysis(specId, complexityScore, totalQuestions, title)` -- sets AI analysis results on spec; `getSpec(specId)` -- fetches spec with all relations (channel, roles with members, questions with answers); `transitionSpecState(specId, fromState, toState)` -- validates state transition per data-model.md State Transitions and updates state + `updatedAt`
- [X] T015 [P] [US1] Implement channel service at `src/services/channel.ts` with functions: `createChannelRecord(specId, slackChannelId, name, nameSuggestions, isCustomName)` -- inserts channel record in database; `createSlackChannel(name)` -- calls Slack API `conversations.create` and returns channel ID, handles name collision by appending `-2`, `-3` etc. per edge case; `inviteMembers(slackChannelId, userIds[])` -- calls Slack API `conversations.invite` for each member; `postWelcomeMessage(slackChannelId, specTitle, pmDisplayName)` -- posts formatted welcome message to channel with spec context
- [X] T016 [P] [US1] Implement role service at `src/services/role.ts` with functions: `createRoles(specId, roles[])` -- bulk inserts spec_roles with name, rationale, sortOrder; `addRoleMembers(roleId, members[])` -- inserts role_members with slackUserId and displayName; `getRolesForSpec(specId)` -- returns roles with their members ordered by sortOrder; `getAllMemberUserIds(specId)` -- returns flat array of unique Slack user IDs across all roles for channel invitation

### LLM Integration for User Story 1

- [X] T017 [US1] Implement OpenRouter LLM client at `src/services/llm.ts` with: OpenAI SDK initialized with `OPENROUTER_API_KEY` and `baseURL: https://openrouter.ai/api/v1`; model constant `anthropic/claude-sonnet-4-5`; function `analyzeDescription(description)` -- sends feature description to LLM with system prompt instructing it to return JSON with `title`, `roles[]` (name + rationale), `complexityScore` (1-10), `estimatedQuestions` (5-20 per SC-004); function `generateChannelNames(description, title)` -- returns exactly 5 Slack-compliant channel name suggestions (lowercase, hyphens, max 80 chars per FR-004); set `max_tokens` per research.md (role analysis ~500, channel names ~500); include retry logic with 3 attempts for transient failures

### API Routes for User Story 1

- [X] T018 [US1] Implement POST `/api/specfactory/start` route handler in `src/routes/specfactory.ts` -- validate `StartRequest` body (pmUserId required, slackChannelId required); check for existing active session and return 409 `ACTIVE_SESSION_EXISTS` with existingSpecId/step if found; create spec via spec service; create session via session service; return 201 `StartResponse` with specId, sessionId, step per contract
- [X] T019 [US1] Implement POST `/api/specfactory/analyze` route handler in `src/routes/specfactory.ts` -- validate `AnalyzeRequest` body (specId UUID, description min 10 words); return 400 `DESCRIPTION_TOO_SHORT` if description is too short; call LLM `analyzeDescription()`; update spec with analysis results via spec service; create roles via role service; update session step to `selecting_channel`; return 200 `AnalyzeResponse` with specId, title, roles, complexityScore, estimatedQuestions per contract
- [X] T020 [US1] Implement POST `/api/specfactory/channel-names` route handler in `src/routes/specfactory.ts` -- validate `ChannelNamesRequest` body (specId UUID); fetch spec and verify it exists (404 if not); call LLM `generateChannelNames()`; store suggestions on channel record; return 200 `ChannelNamesResponse` with specId and exactly 5 suggestions per contract
- [X] T021 [US1] Implement POST `/api/specfactory/channel` route handler in `src/routes/specfactory.ts` -- validate `CreateChannelRequest` body (specId UUID, channelName per Slack naming rules, roles with members); create Slack channel via channel service (handle 409 `CHANNEL_NAME_TAKEN` with suggestedAlternative); invite all members; create channel record in database; post welcome message; transition session step to `ready`; transition spec state from `drafting` to `questioning`; return 201 `CreateChannelResponse` per contract

### Slack Integration for User Story 1

- [X] T022 [US1] Implement `/specfactory` slash command handler at `src/plugins/slack/commands.ts` -- register command with Slack Bolt app; on invocation: call POST `/api/specfactory/start` internally; if 409 (active session exists), reply with ephemeral message showing existing session details; if 201, reply with ephemeral message prompting PM for feature description using Slack modal (`views.open`) with multiline text input
- [X] T023 [US1] Implement Slack interactive component handlers at `src/plugins/slack/interactions.ts` for US1 flow -- handle modal submission for feature description: call `/api/specfactory/analyze` then `/api/specfactory/channel-names`, present channel name selection as message with radio buttons + custom text input; handle channel name selection: call `/api/specfactory/channel-names` response display; handle member selection: iterate roles from analysis, prompt for each role sequentially using Slack user_select elements per FR-006; handle confirmation: call `/api/specfactory/channel` with all collected data
- [X] T024 [US1] Implement Block Kit message builders at `src/plugins/slack/blocks.ts` -- create builder functions: `buildDescriptionModal()` -- returns modal view with multiline text input for feature description; `buildChannelNameSelection(suggestions[])` -- returns blocks with radio buttons for 5 suggestions + text input for custom name per FR-005; `buildRoleAssignment(roleName, rationale)` -- returns blocks with user_select multi-select for assigning members to a role; `buildConfirmation(channelName, roles[])` -- returns blocks summarizing selections with confirm/cancel buttons; `buildWelcomeMessage(specTitle, pmName, roles[])` -- returns formatted welcome message blocks for coordination channel

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. PM can run `/specfactory`, provide a description, get AI-analyzed roles and channel suggestions, select team members, and have a coordination channel created with all members invited.

---

## Phase 4: User Story 2 -- PM Participates in Blind QA (Priority: P1)

**Goal**: After channel creation, the system automatically posts adaptive Blind QA questions using Slack Block Kit UI. PM answers via radio buttons or "Other" option. Question count adapts to feature complexity (5-20 questions).

**Independent Test**: Complete US1 flow, then verify questions appear in the coordination channel using Block Kit UI, answers can be selected via radio buttons, "Other" option accepts custom text, and questions continue until spec is complete.

**Endpoints**: POST `/api/specfactory/questions/next`, POST `/api/specfactory/questions/answer`

**Entities**: questions, answers, specs (complexity/question count fields)

### Services for User Story 2

- [X] T025 [P] [US2] Implement question service at `src/services/question.ts` with functions: `createQuestion(specId, text, options[], sequenceOrder)` -- inserts question record with options JSON array (last option must be "Other" per FR-012); `getNextUnanswered(specId)` -- queries for first question without an answer ordered by sequenceOrder per data-model.md Key Query Patterns; `getQuestionCount(specId)` -- returns total and answered counts; `getQuestionsWithAnswers(specId)` -- returns all questions with their answers for spec generation context
- [X] T026 [P] [US2] Implement answer service at `src/services/answer.ts` with functions: `submitAnswer(questionId, specId, selectedOptionIndex?, customText?)` -- validates: question exists, question not already answered (409 if so), option index in range if provided, customText non-empty if isCustom; inserts answer record with `isCustom` flag and denormalized `selectedOptionText`; increments `spec.answeredQuestions`; returns answer record with progress
- [X] T027 [US2] Implement Blind QA orchestrator at `src/services/blind-qa.ts` with functions: `startBlindQA(specId)` -- generates first batch of questions using LLM based on spec description and complexity score; `generateNextQuestion(specId, previousAnswers[])` -- sends spec context + all previous Q&A pairs to LLM, returns next question with 3-5 options + "Other"; `isComplete(specId)` -- checks if `answeredQuestions >= totalQuestions`; `completeBlindQA(specId)` -- transitions spec state from `questioning` to `generating`, triggers spec generation

### LLM Integration for User Story 2

- [X] T028 [US2] Add Blind QA LLM functions to `src/services/llm.ts` -- function `generateQuestion(specDescription, previousQAs[], questionNumber, totalQuestions)` -- sends context to LLM with system prompt instructing: analyze feature description and prior answers, generate next clarifying question with 3-5 multiple choice options plus "Other" as last option, return JSON with `text` and `options[]` per FR-010/FR-011; function `generateSpec(specDescription, allQAs[], roles[])` -- sends full Q&A transcript to LLM, generates comprehensive Markdown spec document; set `max_tokens` per research.md (question generation ~1000); include prompt that adapts question depth based on complexity score

### API Routes for User Story 2

- [X] T029 [US2] Implement POST `/api/specfactory/questions/next` route handler in `src/routes/specfactory.ts` -- validate `NextQuestionRequest` body (specId UUID); verify spec exists and is in `questioning` state (404 if not); check if all questions answered via `isComplete()` -- if yes, return `QuestionsCompleteResponse` with type `complete`, totalAnswered, and specUrl; otherwise generate next question via blind-qa orchestrator, save to database, return `NextQuestionResponse` with type `question`, question object, and progress per contract
- [X] T030 [US2] Implement POST `/api/specfactory/questions/answer` route handler in `src/routes/specfactory.ts` -- validate `SubmitAnswerRequest` body (specId UUID, questionId UUID, either selectedOptionIndex or customText required); call answer service `submitAnswer()`; if answer completes all questions (`isComplete` returns true), call `completeBlindQA()` to trigger spec generation; return 200 `SubmitAnswerResponse` with specId, questionId, answerId, progress, isComplete per contract

### Slack Integration for User Story 2

- [X] T031 [US2] Implement Blind QA question posting at `src/plugins/slack/interactions.ts` -- add function `postQuestionToChannel(slackChannelId, question, progress)` -- posts Block Kit message with: question text as section block, radio button options as `radio_buttons` element in actions block, progress indicator (e.g., "Question 3 of 12") as context block; store `slackMessageTs` on question record for UI updates; trigger automatically when spec transitions to `questioning` state (after channel creation in US1)
- [X] T032 [US2] Implement Blind QA answer handling at `src/plugins/slack/interactions.ts` -- handle `block_actions` event for radio button selection: extract selected option index from action payload; if "Other" selected, open modal with text input for custom answer; call POST `/api/specfactory/questions/answer` internally; on success, update original message to show selected answer (disable buttons); call POST `/api/specfactory/questions/next` to get and post next question; if complete, post completion summary per US3
- [X] T033 [US2] Add Block Kit builders for Blind QA to `src/plugins/slack/blocks.ts` -- function `buildQuestionMessage(questionText, options[], progress)` -- returns blocks with: header section showing question text, `radio_buttons` accessory with options (including "Other"), context block with "Question X of Y" and percentage; function `buildAnsweredQuestion(questionText, selectedAnswer, progress)` -- returns updated blocks showing the answered state (selected option highlighted, buttons removed); function `buildOtherInputModal(questionId, questionText)` -- returns modal view with text input for custom answer when "Other" is selected

**Checkpoint**: At this point, User Stories 1 AND 2 should both work. After channel creation, Blind QA questions appear automatically, PM can answer them, and the system adapts question count to complexity.

---

## Phase 5: User Story 3 -- PM Reviews Completed Spec (Priority: P2)

**Goal**: After all questions are answered, the system generates a formatted spec document, posts a completion summary to the Slack channel with a web link, and the spec is viewable as formatted HTML at `https://specfactory.app/spec/{ID}`.

**Independent Test**: Complete US2 flow, then verify a completion summary is posted to the Slack channel, summary includes a shareable link, link opens to `specfactory.app/spec/{ID}`, and the spec is displayed in formatted HTML.

**Endpoints**: GET `/api/spec/{id}`

**Entities**: specs (content, contentHtml fields)

### Services for User Story 3

- [X] T034 [P] [US3] Implement spec generation service at `src/services/spec-generator.ts` with functions: `generateSpecContent(specId)` -- fetches spec with all Q&A data, calls LLM `generateSpec()` from T028, stores Markdown result in `spec.content`; `convertToHtml(markdown)` -- converts Markdown spec to HTML with proper formatting, sections, headers, lists, code blocks; stores result in `spec.contentHtml`; transitions spec state from `generating` to `completed` per FR-016/FR-017; function `getSpecUrl(specId)` -- returns `${SPEC_BASE_URL}/spec/${specId}` using env var
- [X] T035 [P] [US3] Install and configure Markdown-to-HTML conversion -- install `marked` (or similar lightweight Markdown parser) as production dependency; create utility at `src/lib/markdown.ts` with function `markdownToHtml(content: string): string` that converts Markdown to sanitized HTML; include proper heading hierarchy, lists, code block syntax highlighting support, and table rendering

### API Routes for User Story 3

- [X] T036 [US3] Implement GET `/api/spec/{id}` route handler in `src/routes/spec.ts` -- validate `id` path parameter as UUID; fetch spec via spec service `getSpec(specId)` with all relations (channel, roles with members, questions with answers); return 404 `SPEC_NOT_FOUND` if not found; if query param `format=html`, return `text/html` content type with rendered HTML page (full HTML document with head, styles, body wrapping `contentHtml`); if `format=json` (default), return `SpecResponse` JSON per contract schema

### Frontend for User Story 3

- [X] T037 [P] [US3] Create spec viewing HTML template at `src/templates/spec-view.html` (or inline in route handler) -- full HTML document with: meta tags for title and description, responsive CSS styling (clean typography, max-width container, proper heading sizes, code block styling, table borders), header with spec title and metadata (PM name, creation date, complexity score), main content area rendering `contentHtml`, footer with "Generated by SpecFactory" branding; must load in under 3 seconds per SC-007
- [X] T038 [P] [US3] Create spec page CSS at `src/templates/spec-styles.css` (or inline) -- responsive design with: max-width 800px centered container, system font stack, heading hierarchy (h1-h4 with appropriate sizes/weights), code blocks with monospace font and background color, blockquotes with left border styling, tables with borders and alternating row colors, mobile-friendly viewport meta tag, print-friendly styles

### Slack Integration for User Story 3

- [X] T039 [US3] Implement completion summary posting at `src/plugins/slack/interactions.ts` -- add function `postCompletionSummary(slackChannelId, specId, specTitle, specUrl, totalQuestions)` -- posts Block Kit message to coordination channel with: header "Spec Complete!", section with spec title, section with summary stats (questions answered, complexity score), section with clickable link to spec URL, context block with timestamp; trigger this when `completeBlindQA()` finishes generating the spec content
- [X] T040 [US3] Add Block Kit builders for completion to `src/plugins/slack/blocks.ts` -- function `buildCompletionSummary(specTitle, specUrl, questionsAnswered, complexityScore)` -- returns blocks with: header block with checkmark emoji and "Specification Complete"; section with spec title as bold text; section with stats (questions answered, complexity score); section with link button "View Full Specification" pointing to specUrl; divider; context block with completion timestamp

**Checkpoint**: All user stories should now be independently functional. Full workflow from `/specfactory` command through Blind QA to viewing the completed spec on the web is operational.

---

## Phase 6: Polish and Cross-Cutting Concerns

**Purpose**: Error handling, edge cases, validation hardening, and robustness improvements that affect multiple user stories.

- [X] T041 Implement session timeout handling -- add scheduled check (setInterval or cron) that queries sessions with `expiresAt < NOW()` and `isActive = true`; deactivate expired sessions; transition associated specs to `abandoned` state; post notification to PM via DM that their session expired per edge case "session persists for 24 hours"
- [X] T042 [P] Implement vague description rejection -- in `/api/specfactory/analyze` handler and Slack interaction handler, count words in description; if fewer than 10 words, return 400 `DESCRIPTION_TOO_SHORT` with message "Feature description must be at least 10 words. Please provide more detail." per edge case and FR-002
- [X] T043 [P] Implement channel name collision handling -- in channel service `createSlackChannel()`, catch Slack API error `name_taken`; automatically try appending `-2`, then `-3`, up to `-9`; if all taken, return 409 `CHANNEL_NAME_TAKEN` with `suggestedAlternative` per edge case "channel name already exists"
- [X] T044 [P] Implement non-workspace member handling -- in Slack interaction handler for member selection, call Slack `users.info` API to verify each selected user exists in workspace; if user not found, display warning message and allow PM to substitute per edge case "selected team member is not in workspace"
- [X] T045 [P] Implement concurrent session isolation -- verify that each `/specfactory` invocation creates an independent session; add database-level unique constraint validation; ensure no data mixing between simultaneous spec creation sessions per SC-009 and edge case
- [X] T046 [P] Implement Slack API retry logic -- wrap all Slack API calls (conversations.create, conversations.invite, chat.postMessage, views.open) with exponential backoff retry (3 attempts, delays: 1s, 2s, 4s); on final failure, notify PM with ephemeral error message per edge case "network errors during Slack API calls"
- [X] T047 [P] Implement 404 handling for non-existent spec IDs -- in GET `/api/spec/{id}` handler, verify spec exists; return 404 with `{"error":"SPEC_NOT_FOUND","message":"No specification found with the given ID."}` per edge case; if `format=html`, return a friendly HTML error page instead of JSON
- [X] T048 Add request validation middleware at `src/routes/middleware.ts` -- add UUID format validation for all `specId` and `id` path/body parameters; add content-type checking (reject non-JSON bodies on POST endpoints); add request body size limit (1MB) to prevent oversized payloads
- [X] T049 [P] Add `updatedAt` auto-update logic -- implement middleware or Drizzle hook to automatically set `updatedAt` to `NOW()` on every UPDATE to specs and sessions tables; verify timestamps are consistent across all state transitions

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies -- can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion (T001 specifically) -- BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2 completion -- can start after foundational is done
- **User Story 2 (Phase 4)**: Depends on Phase 2 completion -- can start in parallel with US1 for service/route work, BUT Slack integration (T031-T032) requires US1 channel creation to be functional
- **User Story 3 (Phase 5)**: Depends on Phase 2 completion -- can start in parallel with US1/US2 for API route and frontend work, BUT completion flow requires US2 Blind QA to be functional
- **Polish (Phase 6)**: Can start after Phase 2; most tasks are independent improvements to existing functionality

### User Story Dependencies

```
Phase 1 (Setup) --> Phase 2 (Foundational) --> Phase 3 (US1: Spec Creation)
                                           --> Phase 4 (US2: Blind QA)
                                           --> Phase 5 (US3: Spec Viewing)
                                           --> Phase 6 (Polish)

US1 (channel creation) --triggers--> US2 (Blind QA starts in channel)
US2 (all questions answered) --triggers--> US3 (spec generation + viewing)
```

- **US1 (P1)**: Can start immediately after Phase 2. No dependencies on other stories.
- **US2 (P1)**: Services and routes (T025-T030) can start after Phase 2 in parallel with US1. Slack integration (T031-T033) depends on US1 Slack integration being functional (T022-T024) since questions post to the coordination channel US1 creates.
- **US3 (P2)**: API route and frontend (T036-T038) can start after Phase 2 in parallel with US1/US2. Completion posting (T039-T040) depends on US2 completion flow (T027 `completeBlindQA`).

### Within Each User Story

1. Services before routes (services provide business logic that routes call)
2. LLM functions before services that depend on them
3. Routes before Slack integration (Slack handlers call routes internally)
4. Block Kit builders can be built in parallel with services

### Parallel Opportunities

**Phase 1 (all [P] tasks run together)**:
```
T002 (.env.example)  |  T003 (drizzle.config)  |  T004 (vitest.config)
T005 (error types)   |  T006 (validation helpers)
```

**Phase 2 (after T007-T009 complete sequentially)**:
```
T010 (Slack client)  |  T011 (middleware)
```

**Phase 3 US1 (services in parallel, then routes, then Slack)**:
```
T013 (session svc)  |  T014 (spec svc)  |  T015 (channel svc)  |  T016 (role svc)
                           then
T017 (LLM client) -- needed by T019, T020
                           then
T018 (start route)  |  T019 (analyze route)  |  T020 (channel-names route)  |  T021 (channel route)
                           then
T022 (slash command)  -->  T023 (interactions)  -->  T024 (block builders -- can parallel with T022)
```

**Phase 4 US2 (services in parallel, then routes, then Slack)**:
```
T025 (question svc)  |  T026 (answer svc)
                          then
T027 (blind-qa orchestrator) + T028 (LLM blind QA functions)
                          then
T029 (next question route)  |  T030 (answer route)
                          then
T031 (question posting)  |  T032 (answer handling)  |  T033 (block builders)
```

**Phase 5 US3 (mostly parallel)**:
```
T034 (spec generator)  |  T035 (markdown conversion)  |  T037 (HTML template)  |  T038 (CSS)
                          then
T036 (spec route -- needs T034, T035)
                          then
T039 (completion posting)  |  T040 (completion blocks)
```

**Phase 6 (all [P] tasks are independent)**:
```
T041 (timeout)  |  T042 (vague desc)  |  T043 (name collision)  |  T044 (non-member)
T045 (concurrency)  |  T046 (retry)  |  T047 (404 page)  |  T048 (validation)  |  T049 (updatedAt)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL -- blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently -- run `/specfactory`, provide description, select channel/members, verify channel creation
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational --> Foundation ready
2. Add User Story 1 --> Test independently --> Demo (MVP!)
3. Add User Story 2 --> Test independently --> Demo (core workflow!)
4. Add User Story 3 --> Test independently --> Demo (full feature!)
5. Add Polish --> Harden edge cases --> Production-ready
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (services + routes + Slack)
   - Developer B: User Story 2 services + routes (T025-T030) -- can start in parallel
   - Developer C: User Story 3 frontend + API route (T034-T038) -- can start in parallel
3. After US1 Slack integration is done:
   - Developer B integrates US2 Slack components (T031-T033)
4. After US2 completion flow works:
   - Developer C integrates US3 completion posting (T039-T040)

---

## Task Count Summary

| Phase | Tasks | Parallelizable |
|-------|-------|---------------|
| Phase 1: Setup | T001-T006 (6 tasks) | 5 of 6 |
| Phase 2: Foundational | T007-T012 (6 tasks) | 2 of 6 |
| Phase 3: US1 | T013-T024 (12 tasks) | 6 of 12 |
| Phase 4: US2 | T025-T033 (9 tasks) | 4 of 9 |
| Phase 5: US3 | T034-T040 (7 tasks) | 4 of 7 |
| Phase 6: Polish | T041-T049 (9 tasks) | 8 of 9 |
| **Total** | **49 tasks** | **29 parallelizable** |

---

## Notes

- [P] tasks = different files, no dependencies -- safe to run in parallel
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- All file paths are relative to repository root (`/Users/atlas/Code/projects/relay/`)
- The `src/` directory is at repository root (not `backend/src/`)
- Avoid: vague tasks, same-file conflicts, cross-story dependencies that break independence
