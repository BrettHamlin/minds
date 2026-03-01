# L2 -- Subsystem Detail

**Last verified**: 2026-02-21

This document covers every collab subsystem **except** the orchestrator state machine,
which has its own dedicated document. Each section describes the subsystem's purpose,
architecture, key files, data flows, relationships to the rest of collab, and
current implementation status.

---

## Table of Contents

1. [Go Attractor Binary](#1-go-attractor-binary)
2. [CLI Client](#2-cli-client)
3. [Express / Relay Server](#3-express--relay-server)
4. [Skills System](#4-skills-system)
5. [Signal Handlers](#5-signal-handlers)
6. [Templates System](#6-templates-system)
7. [Specification Workflow Scripts](#7-specification-workflow-scripts)

---

## 1. Go Attractor Binary

### Purpose and Architecture

The attractor is a pure-Go signal processing engine that sits between tmux agent
panes and the orchestrator. It reads newline-delimited signals from either stdin or
a named pipe, validates them against the pipeline registry, and dispatches them to
registered handlers. The binary is the enforcement layer for the pipeline state
machine -- it decides what happens when a signal arrives, whether that means running
tests, reviewing plans, or advancing the pipeline phase.

**Key design decisions:**

- **Zero external Go modules.** The `go.mod` declares `go 1.22` with no `require`
  directives. Every dependency is from the standard library (`regexp`, `os/exec`,
  `sync`, `encoding/json`, `flag`, `bufio`, `os`, `context`, `fmt`).
- **Per-ticket goroutine isolation.** The `Bridge` struct uses a `sync.Map` of
  ticket-ID-keyed workers. Each ticket gets its own goroutine with a buffered
  channel, so a slow handler for one ticket never blocks signal processing for
  another.
- **Handler registration pattern.** Handlers implement a single `Execute(Context)
  Outcome` interface. The `ExecutionEngine` dispatches signals through four tiers:
  no-ops, fixed transitions, pass-throughs, and registered handlers.

**Signal wire format:**

```
[SIGNAL:TICKET_ID:NONCE] SIGNAL_TYPE | detail text
```

Parsed by `ParseSignal` in `signal_bridge.go` using the regex:
```
^\[SIGNAL:([A-Z]+-\d+):([a-f0-9]+)\] ([A-Z_]+) \| (.+)$
```

The nonce is validated against the pipeline registry JSON file for the ticket.
Signals with stale nonces are silently dropped.

### Key Files

| File | What it does |
|------|-------------|
| `collab/attractor/main.go` | Entry point. Parses `--input` (stdin or pipe path) and `--graph` flags. Walks up from cwd to find `.collab/` directory. Creates the `ExecutionEngine`, registers all handlers, creates the `Bridge`, and runs the input loop. |
| `collab/attractor/signal_bridge.go` | `ParseSignal` regex parser. `Bridge` struct with `sync.Map` of per-ticket workers. `dispatch()` spawns goroutines on first signal per ticket. Nonce validation reads `{ticketID}.json` from the registry directory. Sends tmux messages via `sendToPane()` with 64KB truncation limit. |
| `collab/attractor/dotgen.go` | Generates Graphviz DOT output from `pipeline.json`. Hardcoded phase order: `clarify` -> `plan` -> `tasks` -> `analyze` -> `implement` -> `blindqa` -> `done`. Used for visual debugging of the pipeline graph. |
| `collab/attractor/engine/engine.go` | `ExecutionEngine` with four dispatch tiers: (1) `noops` -- acknowledged, no phase change; (2) `fixedTransition` -- backward jumps via `registry-update.sh`; (3) `passthrough` -- forward via `phase-advance.sh`; (4) registered handlers via `handlers` map. `Process()` builds a `Context` from registry data and calls `handler.Execute()`. |
| `collab/attractor/engine/types.go` | Core type definitions. `CollabSignal` (TicketID, Nonce, SignalType, Detail). `Handler` interface with `Execute(Context) Outcome`. `Outcome` (Status, PreferredLabel, FailureReason). `Context` with 14 fields sourced from registry JSON. `Node`, `Edge`, `Graph` types for DOT generation. |
| `collab/attractor/handlers/registry.go` | `RegisterAll()` wires signal types to handlers. AIGate handles `PLAN_COMPLETE`, `PLAN_REVIEW_NEEDED`, `ANALYZE_COMPLETE`. An `implementRouter` dispatches `IMPLEMENT_COMPLETE` to either `GroupManagerHandler` (for grouped tickets) or `VerifyHandler` (solo tickets). Pass-throughs: `CLARIFY_COMPLETE`, `TASKS_COMPLETE`, `BLINDQA_COMPLETE`. Fixed transition: `BLINDQA_FAILED` jumps back to `implement`. No-ops: all `_QUESTION`, `_ERROR`, `_WAITING` signals. |
| `collab/attractor/handlers/ai_gate.go` | `AIGateHandler` handles plan and analyze review. Assembles review prompts from template files plus worktree artifacts (`spec.md`, `plan.md`, `data-model.md`, `research.md`). Sends assembled prompt to the orchestrator pane via tmux. Two-phase analyze review with remediation tracking via a registry field (`analysis_remediation_done`). |
| `collab/attractor/handlers/verify.go` | `VerifyHandler` reads `verify-config.json` for the test command and `verify-patterns.json` for regex failure patterns. Runs tests via `RunCaptureSeparate` with a configurable timeout. Enforces a "NO EXCUSES" policy on failure -- sends the failure excerpt directly to the agent pane with instructions to fix. |
| `collab/attractor/handlers/deployment.go` | `DeploymentHandler` with a maximum of 3 retries. Increments `retry_count` atomically in the registry. Sends the deploy command to the agent pane. Escalates to the orchestrator when retries are exhausted. |
| `collab/attractor/handlers/group_manager.go` | `GroupManagerHandler` coordinates grouped tickets (e.g., frontend + backend). Queries `group-manage.sh` for role and gate state. Routes backend tickets to `DeploymentHandler`, holds frontend when backend is still deploying, and releases frontend to `VerifyHandler` when backend deployment completes. |
| `collab/attractor/internal/registry/registry.go` | `RegistryData` struct with 14 fields. `ReadRegistry()` reads `{ticketID}.json` from the pipeline registry directory. `WriteField()` uses an atomic temp-file-then-rename pattern to avoid partial writes. |
| `collab/attractor/internal/runner/runner.go` | `Commander` interface (`Run`, `RunCaptureSeparate`). `ExecCommander` with configurable `WorkDir` and `Timeout`. Uses `context.WithTimeout` with a 3-second `WaitDelay` for graceful shutdown. Includes `MockCommander` with a `Stub` map for testing. |

### Inputs, Outputs, and Side Effects

**Inputs:**
- Newline-delimited signals from stdin (default) or a named pipe (`--input` flag)
- Pipeline registry JSON files at `.collab/state/pipeline-registry/{TICKET_ID}.json`
- `verify-config.json` and `verify-patterns.json` from `.collab/config/`
- `pipeline.json` from `.collab/config/` (for DOT generation)
- Template files from `.collab/config/prompts/` (for AI gate review prompts)
- Worktree artifacts: `spec.md`, `plan.md`, `data-model.md`, `research.md`

**Outputs:**
- Tmux messages sent to orchestrator and agent panes via `tmux send-keys`
- Registry JSON updates (atomic writes via temp + rename)
- Shell script invocations: `phase-advance.sh`, `registry-update.sh`, `group-manage.sh`
- DOT graph output to stdout (when `--graph` flag is used)
- Stderr logging for all handler activity

**Side effects:**
- Spawns goroutines per ticket (lifetime of the process)
- Executes test commands in the worktree (VerifyHandler)
- Modifies registry fields: `retry_count`, `analysis_remediation_done`

### Relationship to Rest of Collab

The attractor is the **signal processing backbone** of the pipeline. The orchestrator
sends signals to it (via the named pipe or stdin), and the attractor dispatches those
signals to handlers that either advance the pipeline, run verification, or send
instructions back to agent panes. It reads the same pipeline registry files that the
orchestrator writes, making the registry the shared communication medium.

The attractor does NOT know about the CLI client, Express server, or skills system
directly. It interacts with them only through signals and tmux pane messaging.

### Implementation Status

**Complete and operational.** All handlers are implemented and registered. The binary
compiles with zero external dependencies. Test infrastructure exists via the
`MockCommander` pattern in `internal/runner/runner.go`. The `--graph` flag provides
visual debugging of the pipeline topology.

---

## 2. CLI Client

### Purpose and Architecture

The CLI client (`@collab/specfactory-cli`) is an interactive terminal application
that guides users through creating a software specification. It communicates with the
Express/Relay backend over HTTP and provides a rich terminal UI using `@clack/prompts`.

The workflow is linear and session-based:

```
health check -> create session -> describe feature -> analyze description
  -> suggest channel names -> select channel -> QA loop -> generate spec -> done
```

**Key design decisions:**

- **HTTP client with retry.** All backend calls go through `SpecFactoryClient` which
  wraps fetch with exponential backoff for transient errors (429, 5xx, network errors).
- **Dual output modes.** Interactive mode uses `@clack/prompts` for styled terminal
  UI. JSON mode (`--json`) outputs machine-readable `JSONEnvelope` objects to stdout
  for scripting and pipeline integration.
- **Auto-answer mode.** The `--auto-answer` flag skips interactive prompts, useful
  for CI or automated spec generation.
- **Exit code contract.** `0` = success, `1` = user cancellation, `2` = backend
  error, `3` = network/connection error.

### Key Files

| File | What it does |
|------|-------------|
| `cli/src/index.ts` | Entry point using `commander`. Defines `--backend-url`, `--json`, `--auto-answer`, `--verbose` flags. Orchestrates the full workflow: health -> session -> description -> analyze -> channel names -> select channel -> QA loop -> completion. Registers a SIGINT handler. Reads stdin for piped input. |
| `cli/src/client.ts` | `SpecFactoryClient` class. Resolves backend URL from flag > `SPECFACTORY_BACKEND_URL` env > `http://localhost:3000`. 10-second default timeout, 60-second timeout for LLM-backed endpoints (`/analyze`, `/questions/next`). Verbose mode logs request/response to stderr. 8 API methods: `healthCheck`, `startSession`, `analyzeDescription`, `getChannelNames`, `selectChannel`, `getNextQuestion`, `submitAnswer`, `getSpec`. Error code to human message mapping. |
| `cli/src/output.ts` | `JSONEnvelope` type with `status` (success/error), `data`, `error`, `meta` fields. `ExitCode` enum. `createSuccessEnvelope` and `createErrorEnvelope` factories. `printJSON` writes to stdout. |
| `cli/src/prompts.ts` | Terminal UI functions using `@clack/prompts`. `promptDescription` enforces 10-word minimum. `promptChannelSelection` presents channel name options. `promptTeamMembers` collects Slack handles. `promptQuestion` displays QA questions. `isOtherOption` and `isQAComplete` detection helpers. Progress bar display via `showProgress`. Client-side input validation. |
| `cli/src/retry.ts` | `withRetry` function implementing exponential backoff. Base delay * 2^attempt with a 10-second cap. Transient status codes: 429, 500, 502, 503, 504. Transient error codes: `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`. Permanent errors (4xx other than 429) fail immediately without retry. |
| `cli/src/session.ts` | `generateSessionId()` produces `cli-{username}-{epoch_seconds}` format, truncated to fit varchar(64) column. |
| `cli/package.json` | Package name: `@collab/specfactory-cli` v0.1.0. Dependencies: `@clack/prompts`, `commander`, `node-fetch`. Dev dependencies: `vitest`. |

### Inputs, Outputs, and Side Effects

**Inputs:**
- User keyboard input (interactive mode) or stdin (piped mode)
- `--backend-url` flag or `SPECFACTORY_BACKEND_URL` environment variable
- `--json`, `--auto-answer`, `--verbose` flags

**Outputs:**
- Styled terminal UI (interactive mode) or JSON envelopes to stdout (JSON mode)
- Verbose request/response logs to stderr (when `--verbose` is set)
- Exit codes: 0 (success), 1 (user cancel), 2 (backend error), 3 (network error)

**Side effects:**
- Creates sessions and specs on the backend via HTTP POST calls
- May trigger Slack channel creation on the backend (depending on server config)

### Relationship to Rest of Collab

The CLI client is a **frontend** to the Express/Relay server. It knows nothing about
the orchestrator, attractor, or pipeline. It communicates exclusively through the
`/api/specfactory/*` HTTP endpoints. The session ID it generates becomes the
correlation key for the spec lifecycle on the backend.

### Implementation Status

**Complete and operational.** All workflow steps are implemented. JSON output mode
and auto-answer mode are functional. Retry logic handles transient failures. The
README in `cli/` documents installation and usage.

---

## 3. Express / Relay Server

### Purpose and Architecture

The Express/Relay server is the central backend for spec creation. It exposes HTTP
endpoints consumed by the CLI client and Slack integration, orchestrates LLM calls
through OpenRouter, manages spec lifecycle in PostgreSQL via Drizzle ORM, and
optionally creates Slack channels for team collaboration.

**Key design decisions:**

- **Plugin architecture.** The `PLUGIN_TYPE` environment variable controls which
  frontends are active: `cli` (HTTP endpoints only), `slack` (Slack + HTTP), or
  `both`. Slack is conditionally imported only when needed.
- **OpenRouter for LLM.** All AI calls go through OpenRouter using the `openai`
  SDK pointed at `https://openrouter.ai/api/v1`. The model is
  `anthropic/claude-sonnet-4-5`.
- **Session-based workflow.** Each spec creation flow starts with a session
  (24-hour expiry, 5-minute cleanup interval). Sessions track the current step
  in the workflow and gate transitions.
- **Drizzle ORM.** Database access uses Drizzle with a PostgreSQL connection pool
  (max 20 connections). The schema defines 7 tables with full relations.

### Key Files

| File | What it does |
|------|-------------|
| `src/index.ts` | Express app setup. Reads `PLUGIN_TYPE` from env. Conditionally imports Slack plugin. Mounts routes at `/api/specfactory` and `/api/spec`. Starts session cleanup interval. Starts Slack Bolt in socket mode when Slack is enabled. |
| `src/routes/specfactory.ts` | Six endpoints: `POST /start` (create session + spec), `POST /analyze` (LLM description analysis), `POST /channel-names` (LLM channel name suggestions), `POST /channel` (create/select channel), `POST /questions/next` (get next QA question from LLM), `POST /questions/answer` (submit answer, check completion). Each endpoint validates input and delegates to services. |
| `src/routes/spec.ts` | `GET /api/spec/:id` with format parameter. `format=html` returns a fully styled HTML page with embedded CSS. Default returns JSON with spec data and all relations (channels, roles, members, questions, answers). |
| `src/routes/middleware.ts` | `requestIdMiddleware` attaches `X-Request-ID` header to every request. `errorHandler` catches `AppError` instances and returns structured JSON. `asyncHandler` wraps async route functions to forward errors to Express error middleware. |
| `src/db/schema.ts` | 7-table schema. `specs`: lifecycle states `drafting -> questioning -> generating -> completed -> abandoned`, stores title, description, analysis JSON, content (markdown + HTML). `channels`: Slack channel metadata. `specRoles`: roles identified during analysis. `roleMembers`: people assigned to roles. `questions`: LLM-generated QA questions with order tracking. `answers`: user responses. `sessions`: workflow step tracking with 24-hour expiry. Full Drizzle relations defined between all tables. |
| `src/db/index.ts` | Drizzle ORM instance with a `pg.Pool` (max 20 connections). Reads `DATABASE_URL` from environment. |
| `src/services/llm.ts` | OpenRouter client using the `openai` SDK. Model: `anthropic/claude-sonnet-4-5`. Four functions: `analyzeDescription` (returns title, roles, complexity, estimated question count), `generateChannelNames` (5 suggestions), `generateQuestion` (with previous QA context for continuity), `generateSpec` (full markdown specification from all gathered data). |
| `src/services/spec.ts` | `createSpec`, `updateSpecAnalysis`, `getSpec` (with all relations eagerly loaded), `transitionSpecState` (guarded state transitions), `generateSpecContent` (calls LLM, converts markdown to HTML, transitions to completed). |
| `src/services/spec-generator.ts` | Alternate `generateSpecContent` implementation that uses the `markdownToHtml` utility from `src/lib/markdown.ts`. |
| `src/services/blind-qa.ts` | QA orchestration: `startBlindQA` (transition to questioning), `generateNextQuestion` (delegates to LLM service), `isComplete` (checks if all questions answered), `completeBlindQA` (transitions to generating, calls `generateSpecContent`). |
| `src/services/session.ts` | 24-hour session expiry. `createSession`, `getActiveSession`, `updateSessionStep` (refreshes expiry timestamp), `deactivateSession`. |
| `src/services/session-cleanup.ts` | Runs every 5 minutes. Finds expired sessions. Transitions their associated specs to `abandoned` state. Deactivates the sessions. |
| `src/services/channel.ts` | `createSlackChannel` with name collision retry (appends `-1` through `-9`). `skipSlack` mode returns a synthetic `cli-{name}` channel ID without touching Slack. `inviteMembers` and `postWelcomeMessage` are no-ops in `skipSlack` mode. |
| `src/services/answer.ts` | `submitAnswer` writes an answer record to the database. |
| `src/services/question.ts` | `getNextQuestion` retrieves the next unanswered question for a spec. |
| `src/services/role.ts` | `assignRoles` creates role and member records from the analysis output. |
| `src/plugins/slack/client.ts` | `@slack/bolt` App instance configured for socket mode. Reads `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` from environment. |
| `src/plugins/slack/commands.ts` | `/specfactory` slash command handler. Creates a session, opens a description modal in Slack. |
| `src/plugins/slack/interactions.ts` | Full Slack interactive flow (~1000 lines). Handles: description modal submission -> analysis display -> channel name selection -> member assignment -> channel creation -> QA question display with answer buttons -> custom answer modal -> completion summary. All interactions use Slack Block Kit. |
| `src/plugins/slack/blocks.ts` | Block Kit UI builders: description modal, channel name selection radio buttons, role assignment inputs, confirmation messages, welcome message for new channels. |
| `src/lib/errors.ts` | `AppError` base class with HTTP status code. Subclasses: `NotFoundError` (404), `ConflictError` (409), `ValidationError` (400), `LLMError` (500). `ERROR_CODES` constants for machine-readable error identification. |
| `src/lib/validation.ts` | Input validators: `validateUUID`, `validateDescriptionLength`, `validateSlackChannelName` (Slack naming rules), `validateOptionIndex`. |
| `src/lib/markdown.ts` | Thin wrapper around `marked.parse()` for markdown-to-HTML conversion. |
| `src/lib/slack-retry.ts` | Generic retry with exponential backoff for Slack API calls. Separate from the CLI client's retry logic. |

### Inputs, Outputs, and Side Effects

**Inputs:**
- HTTP requests from CLI client or Slack events from Bolt socket
- Environment variables: `PORT`, `DATABASE_URL`, `OPENROUTER_API_KEY`,
  `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`, `SPEC_BASE_URL`,
  `PLUGIN_TYPE`

**Outputs:**
- JSON HTTP responses to CLI client
- Slack Block Kit messages and modals to Slack users
- Generated spec content (markdown + HTML) stored in database

**Side effects:**
- PostgreSQL reads and writes (specs, sessions, questions, answers, channels, roles)
- OpenRouter API calls for LLM inference
- Slack API calls: channel creation, member invitations, message posting
- Background session cleanup every 5 minutes

### Relationship to Rest of Collab

The Express server is the **data and LLM layer** for spec creation. The CLI client
and Slack plugin are its frontends. The generated specs feed into the pipeline
workflow -- a spec created here becomes the `spec.md` that the orchestrator uses
when launching feature implementation. The server does NOT interact with the
attractor, pipeline registry, or tmux infrastructure directly.

### Implementation Status

**Complete and operational.** All routes, services, and the Slack plugin are
implemented. The database schema is defined with Drizzle and migrations are
available via `drizzle-kit`. The LLM service targets `anthropic/claude-sonnet-4-5`
through OpenRouter.

---

## 4. Skills System

### Purpose and Architecture

Skills are structured instruction sets that define how AI agents perform specific
tasks within the collab pipeline. Each skill has a `SKILL.md` that declares the
skill's identity, principles, and available workflows. Workflows are step-by-step
procedures in separate markdown files.

Skills are invoked by the orchestrator (via agent instructions) or by users directly
as slash commands. They are NOT executable code -- they are structured prompts that
AI agents follow.

**Three skills exist:**

1. **BlindQA** -- Adversarial blind verification of implementation against spec
2. **SpecCreator** -- Creating and updating specs from Linear tickets
3. **SpecCritique** -- Iterative adversarial analysis of spec text quality

### Key Files

#### BlindQA

| File | What it does |
|------|-------------|
| `src/skills/BlindQA/SKILL.md` | Skill definition. Subagent type: `QATester`. Trigger: `collab.blindqa` command. Declares `--interactive` flag for guided resolution mode. References `BlindQAPrinciples.md` and the `BlindVerify` workflow. |
| `src/skills/BlindQA/BlindQAPrinciples.md` | Five core principles: (1) **Context Isolation** -- QA tester never sees implementation, only the spec. (2) **Adversarial Mindset** -- assume bugs exist, try to find them. (3) **Evidence Over Claims** -- every finding needs proof. (4) **Skepticism Protocol** -- do not trust "it works" without verification. (5) **All-or-Nothing** -- partial passes are failures. Defines dual modes: batch text report and interactive guided resolution. |
| `src/skills/BlindQA/Workflows/BlindVerify.md` | 4-step workflow: (1) Extract test specification from the spec, stripping all implementation context. (2) Compose a QA prompt that contains only testable criteria. (3) Launch a QATester subagent with the sanitized prompt. (4) Evaluate results. Optional Step 4b for interactive resolution if `--interactive` is set. |

#### SpecCreator

| File | What it does |
|------|-------------|
| `src/skills/SpecCreator/SKILL.md` | Skill definition. Two workflows: `Create` (new spec from Linear ticket) and `Update` (enhance existing spec). Produces AI-consumable spec format. Integrates Council research and SpecCritique validation. |
| `src/skills/SpecCreator/Workflows/Create.md` | 8-step workflow: (1) Fetch Linear ticket data. (2) Council research -- multiple AI perspectives on the problem domain. (3) Approach selection -- pick the best research direction. (4) Build spec sections (user stories, acceptance criteria, requirements, data model). (5) SpecCritique validation -- iterative quality check. (6) Testing strategy. (7) Dependencies and risks. (8) Update Linear ticket with the spec. Optional Step 7.5: multi-repo splitting when a ticket spans multiple codebases. |
| `src/skills/SpecCreator/Workflows/Update.md` | 7-step workflow: (1) Fetch Linear ticket. (2) Analyze existing spec for gaps. (3) Auto-analyze completeness against a quality checklist. (4) Enhance weak sections. (5) SpecCritique validation. (6) Update Linear ticket. (7) Show a diff of changes. |

#### SpecCritique

| File | What it does |
|------|-------------|
| `src/skills/SpecCritique/SKILL.md` | Skill definition. Performs adversarial analysis of spec text. 7 analysis categories: Completeness, Clarity, Testability, Feasibility, Consistency, Security, Performance. Severity levels: HIGH (must fix), MEDIUM (should fix), LOW (nice to fix). Iterative loop with quality gate. |
| `src/skills/SpecCritique/Workflows/Critique.md` | Pass-specific logic: Pass 1 reports ALL severities. Pass 2+ only continues if HIGH issues remain. Minimum 2 passes, maximum 5. Each pass re-analyzes the full spec text after fixes are applied. Mandatory Linear ticket update when changes are made to the spec. The 7 analysis categories each have specific criteria for what constitutes HIGH/MEDIUM/LOW findings. |

### Inputs, Outputs, and Side Effects

**Inputs:**
- Spec text (markdown) from Linear tickets or local files
- Linear ticket IDs for fetching context
- `--interactive` flag (BlindQA only)
- Implementation artifacts in the worktree (BlindQA reads test results)

**Outputs:**
- Spec documents (SpecCreator creates/updates them)
- Critique reports with severity-ranked findings (SpecCritique)
- Pass/fail verdicts with evidence (BlindQA)
- Linear ticket updates (SpecCreator, SpecCritique)

**Side effects:**
- SpecCreator and SpecCritique update Linear tickets via the Linear API
- BlindQA spawns a QATester subagent (separate AI session)
- SpecCritique emits signals via `emit-spec-critique-signal.ts`
- BlindQA emits signals via `emit-blindqa-signal.ts`

### Relationship to Rest of Collab

Skills are the **behavioral layer** of the pipeline. The orchestrator tells an agent
"run `/collab.blindqa`" and the skill's workflow defines exactly what the agent does.
Skills reference signal handlers to communicate completion/failure back to the
orchestrator. SpecCreator produces the spec that feeds the entire pipeline. BlindQA
is the quality gate before a feature is marked done.

### Implementation Status

**Complete and operational.** All three skills have full SKILL.md definitions and
workflow files. BlindQA has both batch and interactive modes. SpecCreator has both
Create and Update workflows. SpecCritique has iterative pass logic with severity
gating.

---

## 5. Signal Handlers

### Purpose and Architecture

Signal handlers are TypeScript/Bun scripts that emit pipeline signals from within
agent sessions back to the orchestrator. They bridge the gap between skill execution
(which happens inside an AI agent's session) and the pipeline state machine (which
runs in the orchestrator's tmux pane).

**Two patterns exist:**

1. **Deterministic emitters** -- Called directly by skill commands at known lifecycle
   points (`emit-blindqa-signal.ts`, `emit-spec-critique-signal.ts`,
   `emit-question-signal.ts`). The skill controls exactly when signals fire.
2. **Hook-based emitters** -- Triggered by Claude Code's hook system on specific
   tool use events (`question-signal.hook.ts`). These fire automatically when an
   agent uses certain tools.

All signals follow the wire format:
```
[SIGNAL:TICKET_ID:NONCE] SIGNAL_TYPE | detail text
```

### Key Files

| File | What it does |
|------|-------------|
| `src/handlers/pipeline-signal.ts` | Shared signal utilities used by all emitters. `mapResponseState(state, step)` converts a response state and pipeline step into a signal type (e.g., `mapResponseState("completed", "blindqa")` produces `BLINDQA_COMPLETE`). `buildSignalMessage(registry, status, detail)` assembles the full wire-format string. `resolveRegistry()` scans the pipeline registry directory for an entry matching the current `TMUX_PANE`. `truncateDetail(text)` caps detail to 200 characters. |
| `src/handlers/emit-blindqa-signal.ts` | BlindQA-specific deterministic emitter. Maps lifecycle events to response states: `start` -> `awaitingInput` (produces `BLINDQA_QUESTION`), `pass` -> `completed` (produces `BLINDQA_COMPLETE`), `fail` -> `failed` (produces `BLINDQA_FAILED`). Resolves the pipeline registry to find the orchestrator pane. Sends the signal via `Tmux.ts send` to the orchestrator pane. Verifies the current step is `blindqa` (warns if not). |
| `src/handlers/emit-question-signal.ts` | Clarify-phase signal emitter. Maps `question` -> `awaitingInput` and `complete` -> `completed`. Same registry resolution and Tmux.ts send pattern as the BlindQA emitter. |
| `src/handlers/emit-spec-critique-signal.ts` | SpecCritique signal emitter with custom signal names: `SPEC_CRITIQUE_START`, `SPEC_CRITIQUE_PASS`, `SPEC_CRITIQUE_WARN`, `SPEC_CRITIQUE_FAIL`. Unlike the other emitters, this one does NOT use `pipeline-signal.ts` shared utilities -- it has its own signal map and format. Outputs to both stdout and stderr. Uses `execSync` to find the ticket ID from registry files. |
| `src/handlers/resolve-tokens.ts` | Template token resolver for pipeline prompt templates. Three tiers: **Tier 1** -- 7 built-in variables (`TICKET_ID`, `TICKET_TITLE`, `PHASE`, `INCOMING_SIGNAL`, `INCOMING_DETAIL`, `BRANCH`, `WORKTREE`) substituted directly from context JSON. **Tier 2** -- ALL_CAPS unknown tokens: warn to stderr, substitute empty string. **Tier 3** -- lowercase/mixed-case expressions: returned unresolved for the AI agent to evaluate inline. Usage: `bun resolve-tokens.ts "<template>" '<context-json>'`. |
| `src/hooks/question-signal.hook.ts` | Hook-based emitter. Trigger: `PreToolUse:AskUserQuestion` in orchestrated agent sessions. Reads `$TMUX_PANE` to identify itself. Scans the pipeline registry for an entry where `agent_pane_id` matches. Sends `{PHASE}_QUESTION` signal to the orchestrator pane via `tmux send-keys`. Uses two separate `send-keys` calls with a 1-second sleep between text and `C-m` (carriage return), because Claude Code ignores `\n` but responds to `\r`. Always exits 0 to never block the UI. |

### Inputs, Outputs, and Side Effects

**Inputs:**
- CLI arguments: event type and detail message (deterministic emitters)
- `TMUX_PANE` environment variable (all emitters)
- Pipeline registry JSON files at `.collab/state/pipeline-registry/`
- Template strings and context JSON (resolve-tokens.ts)

**Outputs:**
- Signal messages sent to orchestrator pane via `tmux send-keys` or `Tmux.ts`
- Stderr logging of signal emission events
- Resolved template strings to stdout (resolve-tokens.ts)

**Side effects:**
- Tmux key sequences sent to other panes (this is how signals travel)
- Registry directory scanned on every invocation (read-only)

### Relationship to Rest of Collab

Signal handlers are the **communication bus** between agent sessions and the
orchestrator/attractor. When a skill finishes (e.g., BlindQA passes), the handler
emits a `BLINDQA_COMPLETE` signal that the attractor receives and processes. The
question-signal hook ensures the orchestrator knows when an agent is waiting for
input, enabling autonomous navigation of interactive prompts.

`resolve-tokens.ts` supports the orchestrator's prompt template system, replacing
placeholders with runtime values before prompts are sent to agents.

### Implementation Status

**Complete and operational.** All four emitters and the token resolver are
implemented. The `emit-spec-critique-signal.ts` emitter uses a different pattern
(custom signal names, no shared utilities) compared to the BlindQA and question
emitters, which share `pipeline-signal.ts`. This inconsistency is known but
functional.

**Known gap:** `emit-spec-critique-signal.ts` does not use the `pipeline-signal.ts`
shared utilities (`mapResponseState`, `buildSignalMessage`, `resolveRegistry`). It
has its own signal name map and ticket ID resolution logic. This means changes to
the shared signal format require updating this emitter separately.

---

## 6. Templates System

### Purpose and Architecture

Templates are markdown files that provide consistent starting points for spec
creation artifacts. They live in `.specify/templates/` and are copied into feature
directories by the specification workflow scripts (particularly
`create-new-feature.sh` and `setup-plan.sh`).

Templates use placeholder markers (like `{Feature Name}`, `[description]`,
`<!-- ... -->` comments) that are meant to be filled in by humans or AI agents
after the template is copied.

### Key Files

| File | What it does |
|------|-------------|
| `.specify/templates/spec-template.md` | Feature specification template. Sections: header with feature name and ticket ID, Overview (problem statement, goals, non-goals), User Stories (prioritized with `[USx]` labels and acceptance scenarios), Requirements (functional and non-functional), Data Model (entities with fields and types), API/Interface Design, Error Handling, Security Considerations, Success Criteria (measurable metrics). |
| `.specify/templates/plan-template.md` | Implementation plan template. Sections: Technical Context (language, framework, database, existing patterns), Constitution Check (principles that apply), Project Structure (recommended directory layout, alternative options), Task Breakdown (grouped by user story with estimated hours), Complexity Tracking (per-task complexity notes), Risk Register. |
| `.specify/templates/tasks-template.md` | Task list template. Organized by user story phases. Each task has a checkbox, `[USx]` story label, and optional `[P]` marker for tasks that can run in parallel. MVP-first implementation strategy: core tasks first, then enhancements, then polish. |
| `.specify/templates/agent-file-template.md` | Agent context file template (generates CLAUDE.md, .cursorrules, etc.). Sections: Active Technologies (with versions), Project Structure (directory tree), Commands (build, test, lint), Code Style (conventions per language), Recent Changes (auto-updated by `update-agent-context.sh`). |
| `.specify/templates/checklist-template.md` | Generic checklist template. Categories with `CHK###` numbered items. Designed for pre-flight checks, review checklists, or quality gates. |
| `.specify/templates/constitution-template.md` | Project constitution template. Defines immutable principles for a project, governance rules, and versioning policy. Intended as a project-level equivalent of the Nine Articles of Development. |

### Inputs, Outputs, and Side Effects

**Inputs:**
- None -- templates are static files read by workflow scripts.

**Outputs:**
- Copied into feature directories as starting points (e.g., `specs/{feature}/spec.md`,
  `specs/{feature}/plan.md`, `specs/{feature}/tasks.md`).

**Side effects:**
- None -- templates are read-only source material.

### Relationship to Rest of Collab

Templates are consumed by the **specification workflow scripts** (Section 7). The
`create-new-feature.sh` script copies `spec-template.md` and `tasks-template.md`
into the new feature directory. `setup-plan.sh` copies `plan-template.md`. The
`update-agent-context.sh` script uses `agent-file-template.md` as the base for
generating AI agent context files.

The generated artifacts (spec.md, plan.md, tasks.md) are then consumed by the
**orchestrator** and **attractor** during pipeline execution. The AI gate handler
in the attractor reads `spec.md` and `plan.md` from the worktree to assemble
review prompts.

### Implementation Status

**Complete.** All six templates exist and are actively used by the workflow scripts.
The templates are plain markdown with placeholder conventions -- no templating engine
or variable substitution is applied during copying (that is handled later by agents
or by `resolve-tokens.ts` for pipeline prompts).

---

## 7. Specification Workflow Scripts

### Purpose and Architecture

The specification workflow scripts are Bash utilities that manage the creation and
setup of feature development environments. They handle branch creation, worktree
management, template copying, prerequisite checking, and AI agent context file
generation.

All scripts source `common.sh` for shared path resolution and git utilities. They
support both in-repo development and git worktree workflows (where feature work
happens in a separate directory).

### Key Files

| File | What it does |
|------|-------------|
| `.specify/scripts/bash/create-new-feature.sh` | The primary feature scaffolding script. Creates a git branch with a smart name derived from the feature title (stop-word filtering, kebab-case, 244-byte GitHub limit). Supports flags: `--json` (machine-readable output), `--worktree` (create a git worktree instead of a branch), `--worktree-path` (custom worktree location), `--short-name` (override auto-generated name), `--number` (override auto-increment number), `--source-repo` (create worktree from a different repository). Auto-increments feature numbers by scanning `specs/` directories and existing branch names. Creates the feature directory under `specs/{number}-{name}/`, copies `spec-template.md` and `tasks-template.md` from templates. Writes `metadata.json` with `feature_name`, `branch_name`, `worktree_path`, and `created_at` for worktree discovery by the orchestrator. |
| `.specify/scripts/bash/common.sh` | Shared utility functions. `get_repo_root` (walks up to find `.git/`). `get_current_branch` (priority: `SPECIFY_FEATURE` env > git branch > specs dir scan > `main` fallback). `has_git` (git availability check). `check_feature_branch` (verifies current branch follows naming convention). `find_feature_dir_by_prefix` (locates feature directory from branch prefix). `get_feature_paths` (outputs eval-able shell variables for spec, plan, tasks, and other artifact paths). |
| `.specify/scripts/bash/check-prerequisites.sh` | Validates that required artifacts exist before proceeding. Checks for `plan.md` by default. Flags: `--require-tasks` (also require tasks.md), `--include-tasks` (include tasks.md in output if it exists), `--paths-only` (output just file paths, no status messages). Builds a list of available documents and exits non-zero if required files are missing. |
| `.specify/scripts/bash/setup-plan.sh` | Copies `plan-template.md` from templates into the current feature directory as `plan.md`. Supports `--json` flag for machine-readable output. Sources `common.sh` to resolve paths. |
| `.specify/scripts/bash/update-agent-context.sh` | The largest script (~800 lines). Parses `plan.md` to extract technology information: language, framework, database, project type, build tools. Uses this to generate or update AI agent context files for 17+ coding tools (Claude Code, Cursor, Windsurf, Cline, Aider, Continue, Copilot, Cody, TabNine, Qodo, JetBrains AI, Amazon Q, Gemini Code Assist, Double, Trae, Augment, PearAI). Each tool has its own filename convention (CLAUDE.md, .cursorrules, .windsurfrules, etc.). Preserves content between `<!-- MANUAL ADDITIONS START -->` and `<!-- MANUAL ADDITIONS END -->` markers during updates. Uses atomic write pattern (temp file + move) to prevent partial updates. |

### Inputs, Outputs, and Side Effects

**Inputs:**
- Feature title/description (command-line argument to `create-new-feature.sh`)
- Flags: `--json`, `--worktree`, `--worktree-path`, `--short-name`, `--number`,
  `--source-repo`, `--require-tasks`, `--include-tasks`, `--paths-only`
- `plan.md` content (parsed by `update-agent-context.sh` for technology extraction)
- Environment variable: `SPECIFY_FEATURE` (overrides branch detection in `common.sh`)
- Template files from `.specify/templates/`

**Outputs:**
- Git branches (or worktrees with detached working directories)
- Feature directories under `specs/{number}-{name}/` with copied templates
- `metadata.json` in the specs directory (worktree mode) with worktree path
  and branch information
- AI agent context files (CLAUDE.md, .cursorrules, etc.) in the repo root
- JSON-formatted output (when `--json` flag is used)
- Path variable assignments (when `--paths-only` flag is used)

**Side effects:**
- Creates git branches via `git checkout -b` or `git worktree add`
- Writes files to the filesystem (templates, metadata, agent context files)
- Modifies agent context files in-place (preserving manual additions)
- Scans `specs/` directory and git branches for auto-increment numbering

### Relationship to Rest of Collab

The workflow scripts are the **bootstrapping layer** for the pipeline. Before the
orchestrator can run, a feature needs a branch, a spec directory, and template files.
`create-new-feature.sh` sets all of this up. The `metadata.json` it writes is read
by `orchestrator-init.sh` to discover the worktree path and set up symlinks.

`update-agent-context.sh` ensures that whatever AI coding tool an agent uses, it has
a properly configured context file with the right technology stack, project structure,
and recent changes.

`check-prerequisites.sh` is used as a gate check -- the orchestrator or manual
workflow can verify that required artifacts (plan.md, tasks.md) exist before
proceeding to implementation.

### Implementation Status

**Complete and operational.** All five scripts are functional. `create-new-feature.sh`
supports both in-repo and worktree modes with the `--source-repo` flag for external
repositories. `update-agent-context.sh` supports 17+ AI coding tools. `common.sh`
provides reliable path resolution with multiple fallback strategies.

**Known considerations:**
- `update-agent-context.sh` is ~800 lines and handles many edge cases for different
  agent file formats. Adding new AI coding tools requires adding a new section to
  this script.
- The `--source-repo` flag on `create-new-feature.sh` was added to support external
  repositories (e.g., creating a worktree from `paper-clips-backend` while the
  control plane remains in `collab`).

---

## Cross-Subsystem Data Flow

```
                          +-----------------+
                          |  Linear Tickets |
                          +--------+--------+
                                   |
                          (SpecCreator fetches)
                                   v
+----------------+      +---------+---------+      +------------------+
|  CLI Client    | ---> |  Express / Relay  | ---> |  PostgreSQL DB   |
|  (terminal UI) | HTTP |  Server           |      |  (7 tables)      |
+----------------+      |  (LLM via        |      +------------------+
                         |   OpenRouter)    |
+----------------+      +---------+---------+
|  Slack Plugin  | Bolt           |
|  (Block Kit)   | -----> (same server)
+----------------+
                                   |
                          (spec.md produced)
                                   v
+--------------------+   +--------+--------+
| Workflow Scripts   |   | Templates       |
| (create-new-       |-->| (spec, plan,    |
|  feature.sh, etc.) |   |  tasks, agent)  |
+--------+-----------+   +-----------------+
         |
         | (branch + worktree + scaffolding)
         v
+--------+-----------+
| Orchestrator       |   (documented elsewhere)
| (state machine)    |
+--------+-----------+
         |
         | (signals via tmux)
         v
+--------+-----------+      +------------------+
| Go Attractor       | ---> | Signal Handlers  |
| (signal engine)    |      | (emit back to    |
+--------+-----------+      |  orchestrator)   |
         |                  +------------------+
         |
         | (handler actions)
         v
+--------+-----------+
| Skills             |
| (BlindQA,          |
|  SpecCreator,      |
|  SpecCritique)     |
+--------------------+
```

**Signal flow:** Agent sessions emit signals via **signal handlers** -> signals
travel through tmux to the **attractor** -> attractor dispatches to **handlers** ->
handlers either advance the pipeline, run verification, or send instructions back
to agent panes.

**Spec flow:** **Linear ticket** -> **SpecCreator** skill -> `spec.md` in feature
directory -> **orchestrator** reads spec for phase instructions -> **attractor's AI
gate** reads spec for review prompts -> **BlindQA** reads spec for verification
criteria.

**Template flow:** **Templates** are static files -> **workflow scripts** copy them
into feature directories -> **agents** and **orchestrator** consume the filled-in
artifacts.
