# Research: CLI Plugin Architecture

**Feature**: CLI Plugin for SpecFactory (Backend Testing Without Slack)
**Date**: 2026-02-14
**Status**: Complete

---

## FirstPrinciples Analysis

### Core Invariants

The SpecFactory workflow has a fixed sequence of domain operations that are invariant regardless of UI surface. These MUST be preserved:

1. **Session uniqueness per user**: Exactly one active session per user identity at any time. The backend enforces this via `getActiveSession(pmUserId)` returning a conflict. This is a data integrity constraint, not a Slack concern.

2. **Ordered state machine**: The workflow progresses through a deterministic state machine: `drafting -> questioning -> generating -> completed`. Within drafting, session steps follow: `awaiting_description -> analyzing -> selecting_channel -> selecting_members -> confirming -> creating_channel -> ready`. Steps cannot be skipped or reordered because each produces inputs consumed by the next.

3. **LLM-generated artifacts at specific transitions**: Three LLM calls occur at fixed points -- (a) `analyzeDescription` after description submission, (b) `generateChannelNames` after analysis, (c) `generateQuestion` for each Blind QA step. The CLI must trigger these same calls at the same workflow points.

4. **Question-answer causality chain**: Each Blind QA question depends on all prior question-answer pairs. The `generateNextQuestion` function takes `previousAnswers` as input. This means the QA loop is inherently sequential -- a CLI cannot batch or parallelize it.

5. **Database persistence as source of truth**: All state lives in PostgreSQL via Drizzle ORM -- specs, sessions, roles, questions, answers, channels. The CLI must work with the same database, not a separate data store.

6. **Spec completion triggers content generation**: When `isComplete(specId)` returns true, `completeBlindQA` transitions state and calls `generateSpecContent`, which produces the final markdown and HTML. This is a backend concern the CLI triggers but does not implement.

### CLI/Backend Boundary

**Critical insight from codebase analysis**: The current architecture has a clean separation problem. The route layer (`specfactory.ts`) contains mixed concerns -- it calls both pure domain services (session, spec, role, LLM, blind-qa) AND Slack-specific services (channel creation, Slack message posting, Slack user info lookup). The `/api/specfactory/channel` endpoint is the most Slack-entangled route.

**The correct boundary is NOT "CLI calls REST API"**. Here is why:

The Slack plugin (`interactions.ts`) already calls the REST API via `fetch('http://localhost:3000/api/specfactory/...')`. It is itself a REST client. If the CLI also calls the same REST API, we get a clean plugin architecture where both Slack and CLI are equal peers consuming backend APIs. However, the `/api/specfactory/channel` endpoint currently does Slack channel creation, Slack member invitation, and Slack welcome message posting inline. The CLI cannot call this endpoint as-is.

**Decision**: The CLI plugin should call the REST API (same as Slack plugin does), but the backend must be refactored to make Slack operations conditional. The `PLUGIN_TYPE` environment variable (FR-019) controls which plugin initializes:

- `PLUGIN_TYPE=slack` -- Current behavior, Slack Bolt starts, channel endpoint creates Slack channels
- `PLUGIN_TYPE=cli` -- No Slack Bolt, channel endpoint skips Slack operations, records channel name in DB only
- `PLUGIN_TYPE=both` -- Both active, channel endpoint behavior based on request origin header

This means the REST API IS the right protocol. The CLI is a thin HTTP client that orchestrates the same API calls the Slack plugin makes, but without Slack-specific payloads (`slackChannelId` can be a synthetic value like `cli-local`).

### Eliminated Concerns

The following Slack-specific concerns can be removed entirely from the CLI path:

1. **Slack Bolt app initialization** (`@slack/bolt` App, socket mode, signing secret) -- The CLI never touches Slack infrastructure. When `PLUGIN_TYPE=cli`, the server must not import or start Slack Bolt.

2. **Slack channel creation** (`conversations.create`, collision retry logic) -- The CLI uses `--no-slack` mode. Channel names are recorded in the database for the spec, but no actual Slack channel is created.

3. **Slack member invitation** (`conversations.invite`) -- No real Slack users to invite. Role members in CLI mode are recorded with synthetic display names or omitted entirely.

4. **Slack user info lookup** (`users.info` for display names) -- CLI users provide their own identity string. No Slack user profile resolution needed.

5. **Slack message posting** (welcome messages, question posting, completion summary) -- All presentation is handled by the CLI's terminal output, not Slack Block Kit.

6. **Slack Block Kit rendering** (blocks, actions, modals, trigger_ids) -- Entirely replaced by terminal prompts and formatted text output.

7. **Slack-specific metadata** (`message.metadata.event_payload`, `message_ts` for updates) -- CLI tracks state through session step transitions, not Slack message timestamps.

8. **Socket Mode / HTTP receiver** -- The CLI is a process that runs, completes, and exits. It is not a long-lived server receiving webhooks.

### Challenge to Assumptions

**1. Should the CLI replicate Slack plugin's session management approach?**

No, not entirely. The Slack plugin uses `pmUserId` (a Slack user ID like `U01ABC123`) to scope sessions. The CLI should use a similar but Slack-free identifier. However, the fundamental constraint -- one active session per user identity -- MUST be preserved because the backend enforces it at the database level. The CLI simply provides a different user ID format.

The 24-hour session expiry and `isActive` flag are backend concerns that work identically for both plugins. No CLI-specific session logic is needed beyond providing the right user ID.

**2. Is the REST API the right protocol, or should we use a different integration pattern?**

REST API is correct, but for a different reason than assumed. The alternative would be to import and call service functions directly (the CLI as a library consumer rather than HTTP client). This was rejected because:

- The spec requires FR-012: "System MUST use identical REST API endpoints and payloads as Slack plugin." This is non-negotiable -- the CLI must exercise the same API surface to validate it.
- Direct service calls would bypass middleware (error handling, request ID assignment), creating a testing gap.
- The REST boundary provides protocol-level testing that catches serialization bugs, HTTP status code correctness, and content-type handling.

One refinement: the CLI should use the REST API in-process if possible (calling Express route handlers directly via `supertest`-style invocation) for single-process deployments, with HTTP as the default for remote backend testing.

**Decision**: HTTP REST client is the primary integration pattern. The CLI connects to a running backend server. No in-process shortcut.

**3. What are the core invariants that MUST be preserved?**

Addressed above in Core Invariants section. The six invariants are non-negotiable.

**4. What Slack-specific concerns can be eliminated?**

Addressed above in Eliminated Concerns section. Eight categories of Slack logic are removed entirely from the CLI path.

---

## Technical Decisions

### 1. API Key Management

**Decision**: Environment variable (`OPENROUTER_API_KEY`), delegated to the backend.

**Rationale**: The CLI never calls OpenRouter directly. All LLM calls go through the backend's `src/services/llm.ts`, which reads `process.env.OPENROUTER_API_KEY` at server startup. The CLI is a pure HTTP client -- it sends feature descriptions to `/api/specfactory/analyze` and receives structured results. The API key lives where the LLM calls happen: on the backend server.

This means:
- The CLI binary has zero knowledge of LLM providers or API keys
- Backend `.env` contains `OPENROUTER_API_KEY` (already does)
- CLI configuration does NOT include an API key field
- If the backend's LLM calls fail, the CLI receives a 500 error with code `LLM_ERROR` and displays the error message

**Alternatives Considered**:
- *CLI holds API key, passes to backend*: Rejected. Violates separation of concerns. The CLI should not know about LLM implementation. Also creates a security surface -- API keys in CLI process memory, shell history, or config files on developer machines.
- *Config file with API key*: Rejected for the same reason. The key belongs to the server, not the client.
- *CLI calls LLM directly (bypass backend)*: Rejected. Violates FR-012 (identical API endpoints). Also duplicates LLM orchestration logic and breaks the testing purpose of the CLI.

### 2. Backend URL Configuration

**Decision**: Three-tier resolution with precedence: CLI flag > environment variable > default.

The resolution order:
1. `--backend-url` CLI flag (highest priority): `specfactory --backend-url https://staging.example.com/api`
2. `SPECFACTORY_BACKEND_URL` environment variable: For persistent configuration across sessions
3. Default `http://localhost:3000` (lowest priority): Works out of the box for local development

**Rationale**: This follows the standard CLI configuration pattern used by tools like `kubectl`, `docker`, and `gh`. The three-tier approach handles all deployment contexts:

- **Local development** (most common): No configuration needed. Backend runs on default port 3000. Developer runs `specfactory` and it connects to `localhost:3000`.
- **CI/CD pipelines**: Environment variable set in pipeline config. No flag needed per command.
- **Ad-hoc remote testing**: Flag override for one-off connections to staging/preview environments.

**Alternatives Considered**:
- *Config file only (e.g., `~/.specfactory/config.json`)*: Rejected as primary mechanism. Adds file I/O overhead and an extra setup step that violates SC-005 (test locally within 5 minutes). Config files are appropriate for complex tools with many settings, but this CLI has one primary configuration value.
- *Service discovery (DNS, consul, etc.)*: Over-engineered. This is a developer tool, not a microservice mesh.
- *Default localhost only*: Too rigid. Developers testing against shared staging environments or Docker containers on non-default ports need override capability.

### 3. Session ID Format

**Decision**: Format `cli-{username}-{epoch_seconds}`, with `{username}` being the OS username from `os.userInfo().username`.

Examples:
- `cli-atlas-1739520000`
- `cli-devuser-1739523600`

This value is used as the `pmUserId` field in API calls. The backend's session table has `pmUserId` as `varchar(64)`, and the existing Slack plugin uses Slack user IDs (format `U[A-Z0-9]{8,11}`). The CLI format is intentionally distinct to prevent collision.

**Rationale**: The session ID serves three purposes:
1. **Uniqueness per user**: `os.userInfo().username` identifies the developer. Epoch seconds prevent collision across sessions by the same user.
2. **Debuggability**: The prefix `cli-` makes it immediately visible in database queries which sessions came from CLI vs Slack. The username makes it traceable to a developer.
3. **Determinism for testing**: When scripting, the `--session-id` flag can override this with a fixed value for reproducible test scenarios.

The 64-character varchar constraint is satisfied: `cli-` (4) + username (max ~32 on most OS) + `-` (1) + epoch seconds (10) = ~47 characters maximum.

**Alternatives Considered**:
- *UUID v4*: Rejected. UUIDs are not human-readable. When debugging a session in the database, `cli-atlas-1739520000` is immediately informative while `550e8400-e29b-41d4-a716-446655440000` is not.
- *Simple counter or incrementing ID*: Rejected. Not unique across machines or concurrent CLI instances.
- *Hash of machine + user + time*: Over-engineered. The simple format is unique enough for a developer tool and far more debuggable.
- *Just username (e.g., `cli-atlas`)*: Rejected. Would prevent the same user from having multiple sequential sessions (previous session might still be active within 24-hour window).

### 4. API Failure Retry Strategy

**Decision**: Retry transient errors with exponential backoff; fail fast on permanent errors. Maximum 3 attempts for transient failures.

**Classification of errors**:

| HTTP Status | Category | Behavior |
|---|---|---|
| 400 Bad Request | Permanent | Fail immediately. Client input is invalid. |
| 404 Not Found | Permanent | Fail immediately. Resource does not exist. |
| 409 Conflict | Permanent | Fail immediately. Session already exists. |
| 429 Too Many Requests | Transient | Retry with `Retry-After` header or exponential backoff. |
| 500 Internal Server Error | Transient (LLM) | Retry. LLM calls are the most likely source of 500s, and they are inherently flaky. |
| 502/503/504 Gateway errors | Transient | Retry. Server may be restarting. |
| Connection refused (ECONNREFUSED) | Transient | Retry once, then fail with clear message: "Backend server not reachable at {url}. Is it running?" |
| Timeout (ETIMEDOUT) | Transient | Retry with extended timeout. LLM operations can take 30+ seconds. |

**Retry parameters**:
- Maximum attempts: 3
- Base delay: 1 second
- Backoff multiplier: 2x (delays: 1s, 2s, 4s)
- Maximum delay cap: 10 seconds
- Request timeout: 60 seconds for LLM endpoints (`/analyze`, `/channel-names`, `/questions/answer`), 10 seconds for others

**Rationale**: The primary failure mode is LLM flakiness (OpenRouter rate limits, temporary Claude API outages). These are recoverable. A developer sitting at a terminal can tolerate a few seconds of retry delay. However, retrying a 400 error is pointless -- the input will not magically become valid.

The 60-second timeout for LLM endpoints is derived from SC-010: "AI-powered analysis operations in under 60 seconds per operation." If the backend cannot respond in 60 seconds, the LLM call has failed.

**Alternatives Considered**:
- *Always fail fast (no retries)*: Rejected. LLM operations are the heart of SpecFactory and the most failure-prone component. Failing fast on every OpenRouter hiccup would make the CLI frustrating to use. The developer would have to manually re-run repeatedly.
- *Unlimited retries*: Rejected. If the backend is truly down, infinite retries waste the developer's time. Three attempts with exponential backoff balances resilience with responsiveness.
- *User-configurable retry count*: Deferred. Not needed for MVP. The fixed policy (3 retries, exponential backoff) is reasonable for all cases. Can be added later via `--max-retries` flag if needed.

### 5. JSON Output Schema

**Decision**: Structured JSON envelope with `status`, `data`, and `error` fields. All responses wrapped consistently.

**Success schema**:
```json
{
  "status": "success",
  "data": {
    "specId": "uuid",
    "sessionId": "uuid",
    "phase": "string",
    "result": { ... }
  },
  "meta": {
    "timestamp": "ISO-8601",
    "duration_ms": 1234,
    "backend_url": "http://localhost:3000"
  }
}
```

**Error schema**:
```json
{
  "status": "error",
  "error": {
    "code": "string",
    "message": "string",
    "details": { ... },
    "retryable": true
  },
  "meta": {
    "timestamp": "ISO-8601",
    "duration_ms": 1234,
    "backend_url": "http://localhost:3000"
  }
}
```

**Phase-specific `data.result` shapes**:

**Start session**:
```json
{
  "specId": "550e8400-...",
  "sessionId": "a1b2c3d4-...",
  "step": "awaiting_description"
}
```

**Analyze description**:
```json
{
  "specId": "550e8400-...",
  "title": "User Authentication System",
  "roles": [
    { "name": "Backend Engineer", "rationale": "API implementation" }
  ],
  "complexityScore": 7,
  "estimatedQuestions": 12
}
```

**Channel name suggestions**:
```json
{
  "specId": "550e8400-...",
  "suggestions": [
    "feature-user-auth",
    "spec-auth-system",
    "auth-implementation",
    "user-login-feature",
    "auth-design-spec"
  ]
}
```

**Channel selection (no-slack mode)**:
```json
{
  "specId": "550e8400-...",
  "channelName": "feature-user-auth",
  "channelCreated": false,
  "note": "Channel name recorded (--no-slack mode)"
}
```

**Question received**:
```json
{
  "specId": "550e8400-...",
  "question": {
    "id": "q1-uuid",
    "text": "What authentication methods should be supported?",
    "options": ["Email/password only", "OAuth + email/password", "SSO enterprise", "Other"],
    "sequenceOrder": 1
  },
  "progress": { "current": 1, "total": 12 }
}
```

**Answer submitted**:
```json
{
  "specId": "550e8400-...",
  "questionId": "q1-uuid",
  "answerId": "a1-uuid",
  "progress": { "answered": 1, "total": 12 },
  "isComplete": false
}
```

**Workflow complete**:
```json
{
  "specId": "550e8400-...",
  "status": "completed",
  "title": "User Authentication System",
  "totalQuestions": 12,
  "specUrl": "http://localhost:3000/api/spec/550e8400-...?format=html",
  "complexityScore": 7
}
```

**Rationale**: The envelope pattern (`status` + `data` or `error` + `meta`) is standard for machine-readable CLI output. Key design choices:

- **`status` field at root**: Allows scripts to check `jq .status` before parsing data. Eliminates ambiguity about whether a response is success or error.
- **`meta.duration_ms`**: Essential for performance testing (SC-010). Scripts can assert `duration_ms < 60000` for LLM operations.
- **`meta.backend_url`**: Debugging aid. When a CI pipeline fails, the log shows which backend was targeted.
- **`error.retryable`**: Allows automation scripts to decide whether to retry programmatically.
- **`error.code`**: Matches the backend's error code system (`ACTIVE_SESSION_EXISTS`, `DESCRIPTION_TOO_SHORT`, etc.) for programmatic error handling.
- **Phase-specific result shapes mirror backend API responses**: The `data.result` fields are pass-through from the backend REST API responses. The CLI wraps them in the envelope but does not transform the structure.

**Alternatives Considered**:
- *Flat JSON (no envelope)*: Rejected. Without a `status` field, scripts cannot distinguish success from error without inspecting specific fields. Fragile for automation.
- *NDJSON (one object per line)*: Considered for streaming progress but rejected for MVP. The workflow has discrete phases, not streaming events. NDJSON could be added later for verbose/streaming mode.
- *Custom format per command*: Rejected. Inconsistency across commands makes automation harder. The envelope provides a contract that all commands follow.

---

## Architecture Summary

The CLI plugin is a **thin HTTP client** that:

1. Orchestrates the same REST API calls that `interactions.ts` (Slack plugin) makes
2. Replaces Slack Block Kit rendering with terminal prompts (`@clack/prompts`)
3. Uses `os.userInfo().username` + timestamp as user identity instead of Slack user ID
4. Skips Slack-specific operations (channel creation, member invitation, message posting)
5. Wraps all output in a consistent JSON envelope when `--json` is passed
6. Exits with appropriate status codes for script detection

The backend requires one change: conditional Slack initialization based on `PLUGIN_TYPE` environment variable, and the `/api/specfactory/channel` endpoint must skip Slack operations when running in CLI mode.

All LLM operations, session management, question generation, and spec persistence remain identical between Slack and CLI paths. The CLI tests the same code paths the Slack plugin exercises, which is the entire point.
