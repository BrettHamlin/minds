# Data Model: CLI Plugin for SpecFactory

**Feature Branch**: `001-specfactory-cli`
**Date**: 2026-02-14
**Source**: [spec.md](spec.md) | [research.md](research.md) | Backend schema `src/db/schema.ts`

---

## Overview

The CLI plugin does NOT define new database tables. It operates as a thin HTTP client against the existing backend REST API, which persists all state in PostgreSQL via Drizzle ORM. This document describes the existing backend entities the CLI interacts with, the CLI-side transient state it maintains in memory, and the state machine governing workflow progression.

---

## Backend Entities (Existing -- No Changes)

The CLI reads and writes these entities exclusively through REST API calls. The database schema is defined in `src/db/schema.ts`.

### 1. Spec

The central entity representing a feature specification being created.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | `uuid` | PK, auto-generated | Unique spec identifier |
| `title` | `varchar(255)` | NOT NULL | Feature title (set to "Untitled Spec" initially, updated after LLM analysis) |
| `description` | `text` | NOT NULL | Feature description provided by developer (minimum 10 words) |
| `state` | `enum(spec_state)` | NOT NULL, default `'drafting'` | Current lifecycle state (see State Machine below) |
| `pmUserId` | `varchar(64)` | NOT NULL, indexed | User identity -- CLI uses format `cli-{username}-{epoch}` |
| `pmDisplayName` | `varchar(255)` | nullable | Display name for the user |
| `complexityScore` | `integer` | nullable | LLM-assessed complexity (set after analysis) |
| `totalQuestions` | `integer` | nullable | LLM-estimated question count (set after analysis) |
| `answeredQuestions` | `integer` | NOT NULL, default `0` | Running count of answered questions |
| `content` | `text` | nullable | Generated markdown spec content (set on completion) |
| `contentHtml` | `text` | nullable | HTML rendering of content (set on completion) |
| `createdAt` | `timestamptz` | NOT NULL, default now | Creation timestamp |
| `updatedAt` | `timestamptz` | NOT NULL, default now | Last update timestamp |

**Indexes**: `pmUserId`, `state`, `createdAt`

**Validation Rules (enforced by backend)**:
- `description` must contain 10 or more words (FR-002, validated by `validateDescriptionLength`)
- `state` transitions follow the state machine (enforced by `transitionSpecState`)
- `pmUserId` must be unique per active session (enforced by `getActiveSession`)

---

### 2. Session

Tracks a single user's active workflow execution. One-to-one with Spec.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | `uuid` | PK, auto-generated | Session identifier |
| `specId` | `uuid` | FK -> specs.id, unique, cascade delete | Associated spec |
| `pmUserId` | `varchar(64)` | NOT NULL, indexed | User identity (matches spec.pmUserId) |
| `currentStep` | `enum(session_step)` | NOT NULL, default `'awaiting_description'` | Current workflow step within drafting phase |
| `currentRoleIndex` | `integer` | default `0` | Index of role being processed for member assignment |
| `slackChannelId` | `varchar(64)` | nullable | Slack channel ID -- CLI uses synthetic value `cli-local` |
| `expiresAt` | `timestamptz` | NOT NULL | Session expiry (24 hours from creation, refreshed on step change) |
| `isActive` | `boolean` | NOT NULL, default `true` | Whether session is active |
| `metadata` | `jsonb` | nullable | Arbitrary metadata (plugin type, flags) |
| `createdAt` | `timestamptz` | NOT NULL, default now | Creation timestamp |
| `updatedAt` | `timestamptz` | NOT NULL, default now | Last update timestamp |

**Indexes**: `specId` (unique), `pmUserId`, `expiresAt`, `isActive`

**Validation Rules**:
- Only one active session per `pmUserId` at any time (backend returns 409 ACTIVE_SESSION_EXISTS)
- Session auto-expires after 24 hours (`expiresAt` checked on queries)
- `currentStep` follows the session step state machine (see below)

**CLI-specific behavior**:
- `pmUserId` format: `cli-{os.username}-{epoch_seconds}` (max ~47 chars, within varchar(64))
- `slackChannelId`: Set to `cli-local` (synthetic, no real Slack channel)

---

### 3. Channel

Records the channel name selected for the spec. In CLI mode, no actual Slack channel is created.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | `uuid` | PK, auto-generated | Channel record identifier |
| `specId` | `uuid` | FK -> specs.id, unique, cascade delete | Associated spec |
| `slackChannelId` | `varchar(64)` | NOT NULL, unique | Slack channel ID -- CLI uses `cli-local` |
| `name` | `varchar(80)` | NOT NULL | Selected channel name |
| `nameSuggestions` | `jsonb (string[])` | nullable | LLM-generated name suggestions |
| `isCustomName` | `boolean` | NOT NULL, default `false` | Whether user entered a custom name |
| `createdAt` | `timestamptz` | NOT NULL, default now | Creation timestamp |

**Indexes**: `specId` (unique), `slackChannelId` (unique)

**Validation Rules**:
- Channel name must match pattern `^[a-z0-9][a-z0-9-]{0,79}$` (Slack naming convention, also used in CLI mode for consistency)
- Maximum 80 characters

---

### 4. SpecRole

Roles identified by LLM analysis of the feature description.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | `uuid` | PK, auto-generated | Role identifier |
| `specId` | `uuid` | FK -> specs.id, cascade delete | Associated spec |
| `name` | `varchar(128)` | NOT NULL | Role name (e.g., "Backend Engineer") |
| `rationale` | `text` | nullable | Why this role is relevant |
| `sortOrder` | `integer` | NOT NULL, default `0` | Display ordering |
| `createdAt` | `timestamptz` | NOT NULL, default now | Creation timestamp |

**Indexes**: `specId`

---

### 5. RoleMember

Members assigned to roles. In CLI mode, this may be empty or use synthetic identifiers.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | `uuid` | PK, auto-generated | Member record identifier |
| `roleId` | `uuid` | FK -> specRoles.id, cascade delete | Associated role |
| `slackUserId` | `varchar(64)` | NOT NULL | User ID -- CLI uses synthetic values |
| `displayName` | `varchar(255)` | nullable | Display name |
| `createdAt` | `timestamptz` | NOT NULL, default now | Creation timestamp |

**Indexes**: `roleId`, `(roleId, slackUserId)` unique

---

### 6. Question

Blind QA questions generated by the LLM, one at a time in sequence.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | `uuid` | PK, auto-generated | Question identifier |
| `specId` | `uuid` | FK -> specs.id, cascade delete | Associated spec |
| `text` | `text` | NOT NULL | Question text |
| `options` | `jsonb (string[])` | NOT NULL | Multiple choice options (includes "Other" as last option) |
| `sequenceOrder` | `integer` | NOT NULL | 1-based order in the QA sequence |
| `slackMessageTs` | `varchar(64)` | nullable | Slack message timestamp -- not used by CLI |
| `createdAt` | `timestamptz` | NOT NULL, default now | Creation timestamp |

**Indexes**: `specId`, `(specId, sequenceOrder)` unique

**Invariant**: Each question depends on all prior question-answer pairs. Questions are generated sequentially and cannot be parallelized. The LLM's `generateQuestion` function takes `previousAnswers` as input.

---

### 7. Answer

Responses to Blind QA questions.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | `uuid` | PK, auto-generated | Answer identifier |
| `questionId` | `uuid` | FK -> questions.id, unique, cascade delete | Associated question (one answer per question) |
| `specId` | `uuid` | FK -> specs.id, cascade delete | Associated spec |
| `selectedOptionIndex` | `integer` | nullable | Index of chosen option (0-based) |
| `selectedOptionText` | `varchar(1024)` | nullable | Text of chosen option |
| `customText` | `text` | nullable | Custom text when "Other" is selected |
| `isCustom` | `boolean` | NOT NULL, default `false` | Whether answer uses custom text |
| `createdAt` | `timestamptz` | NOT NULL, default now | Creation timestamp |

**Indexes**: `questionId` (unique), `specId`

**Validation Rules**:
- Either `selectedOptionIndex` or `customText` must be provided
- When `isCustom` is true, `customText` must be non-empty
- `selectedOptionIndex` must be in range `[0, options.length - 1]` (validated by `validateOptionIndex`)

---

## Entity Relationship Diagram

```
+----------+       1:1       +-----------+
|   Spec   |<--------------->|  Session  |
+----------+                 +-----------+
| id (PK)  |                 | id (PK)   |
| title    |                 | specId (FK, unique)
| desc     |                 | pmUserId  |
| state    |                 | currentStep
| pmUserId |                 | slackChannelId
| ...      |                 | expiresAt |
+----------+                 | isActive  |
     |                       +-----------+
     |
     +----------- 1:1 ----------+
     |                          |
     v                          v
+-----------+             +-----------+
|  Channel  |             | SpecRole  |
+-----------+             +-----------+
| id (PK)   |             | id (PK)   |
| specId(FK)|             | specId(FK)|
| name      |             | name      |
| slackChId |             | rationale |
+-----------+             | sortOrder |
                          +-----------+
                               |
                               | 1:N
                               v
                          +------------+
                          | RoleMember |
                          +------------+
                          | id (PK)    |
                          | roleId(FK) |
                          | slackUserId|
                          | displayName|
                          +------------+

+----------+
|   Spec   |
+----------+
     |
     | 1:N
     v
+-----------+       1:1       +----------+
| Question  |<--------------->|  Answer  |
+-----------+                 +----------+
| id (PK)   |                 | id (PK)  |
| specId(FK) |                | questionId(FK, unique)
| text       |                | specId(FK)
| options    |                | selectedOptionIndex
| seqOrder   |                | customText
+-----------+                 | isCustom |
                              +----------+
```

---

## CLI-Side Transient State (In-Memory Only)

The CLI maintains lightweight state during a single execution. This state is NOT persisted to any database -- it exists only in the CLI process memory and is discarded when the process exits.

### CLIWorkflowState

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `specId` | `string (uuid)` | POST /start response | Spec being built |
| `sessionId` | `string (uuid)` | POST /start response | Active session |
| `pmUserId` | `string` | Generated locally | Format: `cli-{username}-{epoch}` |
| `backendUrl` | `string` | Flag > env > default | Backend base URL |
| `currentPhase` | `enum` | Derived from API responses | Current workflow phase |
| `outputMode` | `'interactive' \| 'json'` | CLI flag `--json` | Output format |
| `autoAnswer` | `boolean` | CLI flag `--auto-answer` | Auto-select first option |
| `noSlack` | `boolean` | CLI flag `--no-slack` | Skip Slack operations |
| `verbose` | `boolean` | CLI flag `--verbose` | Show request/response details |

### CLI Phase Enum

The CLI tracks a simplified view of the workflow phases for display and orchestration:

```
start -> description -> analysis -> channel_selection -> qa_loop -> complete
```

This maps to backend states as follows:

| CLI Phase | Spec State | Session Step | Description |
|-----------|-----------|--------------|-------------|
| `start` | `drafting` | `awaiting_description` | Session created, awaiting input |
| `description` | `drafting` | `awaiting_description` | User entering description |
| `analysis` | `drafting` | `analyzing` | LLM analyzing description |
| `channel_selection` | `drafting` | `selecting_channel` | User choosing channel name |
| `qa_loop` | `questioning` | `ready` | Blind QA question-answer cycle |
| `complete` | `completed` | n/a | Spec generation finished |

---

## State Machines

### Spec State Machine

The spec lifecycle governs the high-level workflow. Transitions are enforced by `transitionSpecState(specId, fromState, toState)`, which fails if the current state does not match `fromState`.

```
                                    +---> abandoned
                                    |
drafting ---> questioning ---> generating ---> completed
   |                                              ^
   +--- (24h timeout or explicit cancel) ---------+
                abandoned
```

| Transition | Trigger | Backend Function |
|-----------|---------|-----------------|
| `drafting` -> `questioning` | Channel selected, first question generated | `transitionSpecState` in POST /channel |
| `questioning` -> `generating` | All questions answered (`isComplete` returns true) | `completeBlindQA` in POST /questions/answer |
| `generating` -> `completed` | Spec content generated (markdown + HTML) | `generateSpecContent` |
| Any -> `abandoned` | Session expires (24h) or explicit cancellation | Session cleanup service |

### Session Step Machine (Within Drafting)

Session steps track fine-grained progress within the `drafting` spec state.

```
awaiting_description --> analyzing --> selecting_channel --> selecting_members
                                                                  |
                                                                  v
                                                            confirming
                                                                  |
                                                                  v
                                                          creating_channel
                                                                  |
                                                                  v
                                                               ready
```

**CLI simplifications**: In CLI `--no-slack` mode, the steps `selecting_members`, `confirming`, and `creating_channel` are compressed. The CLI submits a channel name selection and the backend (with PLUGIN_TYPE=cli) transitions directly from `selecting_channel` to `ready`, skipping Slack-specific intermediate steps.

| Step Transition | CLI Trigger | API Call |
|----------------|-------------|----------|
| `awaiting_description` -> `analyzing` | User submits description | POST /analyze |
| `analyzing` -> `selecting_channel` | Analysis completes | POST /analyze (response) |
| `selecting_channel` -> `ready` | User selects channel (CLI mode) | POST /channel |
| `ready` -> (spec transitions to `questioning`) | Channel recorded, first question generated | POST /channel (response triggers blind QA start) |

### Answer Submission Flow

Within the `questioning` spec state, the QA loop follows this pattern per question:

```
[fetch question] --> [display to user] --> [accept answer] --> [submit answer]
       ^                                                            |
       |                                                            v
       +---- (not complete) <-- [check completion] --- (complete) --+--> [generate spec]
```

| Step | API Call | Completion Check |
|------|----------|-----------------|
| Fetch next question | POST /questions/next | Response `type: 'complete'` means done |
| Submit answer | POST /questions/answer | Response `isComplete: true` means done |
| Generate spec | Triggered server-side by `completeBlindQA` | n/a |

---

## Validation Summary

All validation is performed at two levels:

### Client-Side (CLI)

The CLI validates before making API calls to provide immediate feedback (FR-013):

| Rule | Validation | Error Message |
|------|-----------|---------------|
| Description length | 10+ words (split on whitespace) | "Feature description must be at least 10 words" |
| Channel name format | `^[a-z0-9][a-z0-9-]{0,79}$` | "Channel name must start with letter/number, contain only lowercase letters, numbers, hyphens" |
| Option selection range | Integer in `[1, options.length]` (1-based for CLI display) | "Please select a valid option number" |
| Backend URL format | Valid URL parse | "Invalid backend URL format" |
| Session ID format | Non-empty string, max 64 chars | "Invalid session identifier" |

### Server-Side (Backend)

The backend re-validates all input (defense in depth):

| Rule | Validator | HTTP Status | Error Code |
|------|-----------|-------------|------------|
| UUID format | `validateUUID` | 400 | `INVALID_UUID` |
| Description length (10+ words) | `validateDescriptionLength` | 400 | `DESCRIPTION_TOO_SHORT` |
| Channel name format | `validateSlackChannelName` | 400 | `INVALID_CHANNEL_NAME` |
| Option index in range | `validateOptionIndex` | 400 | `INVALID_OPTION_INDEX` |
| Required fields present | Route handlers | 400 | `MISSING_REQUIRED_FIELDS` |
| No active session exists | `getActiveSession` | 409 | `ACTIVE_SESSION_EXISTS` |
| Spec exists | `getSpec` | 404 | `SPEC_NOT_FOUND` |
| Valid state transition | `transitionSpecState` | 500 | Internal error |
