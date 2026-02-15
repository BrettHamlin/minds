# Data Model: PM Workflow in Slack (MVP Core)

**Branch**: `001-pm-workflow-slack` | **Date**: 2026-02-14 | **Spec**: [spec.md](./spec.md)

**ORM**: Drizzle ORM with PostgreSQL (`pg` driver)
**Schema Location**: `src/db/schema.ts`

---

## Entity Relationship Overview

```
Session 1──1 Spec 1──1 Channel
                │
                ├──* SpecRole 1──* RoleMember
                │
                └──* Question 0──1 Answer
```

- A **Session** tracks the active workflow state for one spec creation attempt.
- A **Spec** is the central entity; it owns roles, questions, and a channel.
- A **Channel** is the Slack coordination channel created for the spec.
- A **SpecRole** represents an AI-determined team role (e.g., "Backend Developer").
- A **RoleMember** maps a Slack user to a role on a spec.
- A **Question** is a Blind QA question with its answer options.
- An **Answer** records the PM's response to a question.

---

## Enumerations

```typescript
// src/db/schema.ts

import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// --- Enumerations ---

/** Spec lifecycle states. See "State Transitions" section below. */
export const specStateEnum = pgEnum('spec_state', [
  'drafting',       // PM is providing description, selecting channel/roles
  'questioning',    // Blind QA in progress
  'generating',     // AI is generating the final spec document
  'completed',      // Spec generated and viewable
  'abandoned',      // Session timed out or PM explicitly cancelled
]);

/** Session workflow steps within the drafting phase. */
export const sessionStepEnum = pgEnum('session_step', [
  'awaiting_description',   // Waiting for feature description input
  'analyzing',              // AI analyzing description for roles
  'selecting_channel',      // PM choosing channel name
  'selecting_members',      // PM assigning members to roles (sequential)
  'confirming',             // PM confirming before channel creation
  'creating_channel',       // System creating Slack channel
  'ready',                  // Channel created, ready for Blind QA
]);
```

---

## Table Definitions

### specs

The central entity representing a feature specification.

```typescript
export const specs = pgTable('specs', {
  /** Primary key. Used in web URL: /spec/{id} */
  id: uuid('id').primaryKey().defaultRandom(),

  /** Human-readable title derived from feature description. */
  title: varchar('title', { length: 255 }).notNull(),

  /** Original feature description provided by the PM. */
  description: text('description').notNull(),

  /** Current lifecycle state. */
  state: specStateEnum('state').notNull().default('drafting'),

  /** Slack user ID of the PM who initiated the spec. */
  pmUserId: varchar('pm_user_id', { length: 64 }).notNull(),

  /** PM display name (cached from Slack profile). */
  pmDisplayName: varchar('pm_display_name', { length: 255 }),

  /** AI complexity score (1-10). Determines question count (FR-011). */
  complexityScore: integer('complexity_score'),

  /** Total number of questions determined by AI. Range: 5-20 (SC-004). */
  totalQuestions: integer('total_questions'),

  /** Number of questions answered so far. */
  answeredQuestions: integer('answered_questions').notNull().default(0),

  /** Generated spec content (Markdown). Populated when state = 'completed'. */
  content: text('content'),

  /** Generated spec content as HTML. Populated when state = 'completed'. */
  contentHtml: text('content_html'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('specs_pm_user_id_idx').on(table.pmUserId),
  index('specs_state_idx').on(table.state),
  index('specs_created_at_idx').on(table.createdAt),
]);
```

**Validation Rules:**
- `title`: 1-255 characters, trimmed.
- `description`: Minimum 10 words (FR edge case: too-vague descriptions).
- `complexityScore`: Integer 1-10, nullable until AI analysis completes.
- `totalQuestions`: Integer 5-20 per SC-004, nullable until AI determines count.
- `answeredQuestions`: Non-negative integer, must not exceed `totalQuestions`.
- `state`: Must follow valid state transitions (see State Transitions section).

---

### channels

Slack coordination channel created for a spec.

```typescript
export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** FK to the spec this channel belongs to. One channel per spec. */
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),

  /** Slack channel ID (e.g., "C07ABC123"). */
  slackChannelId: varchar('slack_channel_id', { length: 64 }).notNull(),

  /** Channel name as it appears in Slack. */
  name: varchar('name', { length: 80 }).notNull(),

  /** The 5 AI-generated channel name suggestions (FR-004). */
  nameSuggestions: jsonb('name_suggestions').$type<string[]>(),

  /** Whether the PM selected a suggestion or entered a custom name. */
  isCustomName: boolean('is_custom_name').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('channels_spec_id_idx').on(table.specId),
  uniqueIndex('channels_slack_channel_id_idx').on(table.slackChannelId),
]);
```

**Validation Rules:**
- `slackChannelId`: Must be a valid Slack channel ID format (starts with "C").
- `name`: 1-80 characters, lowercase, hyphens allowed, must conform to Slack channel naming rules.
- `nameSuggestions`: JSON array of exactly 5 strings when populated (FR-004).
- One channel per spec (enforced by unique index on `specId`).

---

### spec_roles

AI-determined team roles for a spec (FR-003).

```typescript
export const specRoles = pgTable('spec_roles', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** FK to the spec this role belongs to. */
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),

  /** Role name determined by AI (e.g., "Backend Developer", "Designer"). */
  name: varchar('name', { length: 128 }).notNull(),

  /** AI-provided explanation of why this role is needed. */
  rationale: text('rationale'),

  /** Display order for sequential member selection (FR-006). */
  sortOrder: integer('sort_order').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('spec_roles_spec_id_idx').on(table.specId),
]);
```

**Validation Rules:**
- `name`: 1-128 characters, not empty.
- `sortOrder`: Non-negative integer. Used for sequential prompting (FR-006).

---

### role_members

Maps Slack users to roles on a spec.

```typescript
export const roleMembers = pgTable('role_members', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** FK to the role this member is assigned to. */
  roleId: uuid('role_id').notNull().references(() => specRoles.id, { onDelete: 'cascade' }),

  /** Slack user ID of the team member. */
  slackUserId: varchar('slack_user_id', { length: 64 }).notNull(),

  /** Display name (cached from Slack profile). */
  displayName: varchar('display_name', { length: 255 }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('role_members_role_id_idx').on(table.roleId),
  uniqueIndex('role_members_role_user_idx').on(table.roleId, table.slackUserId),
]);
```

**Validation Rules:**
- `slackUserId`: Must be a valid Slack user ID format (starts with "U" or "W").
- Unique constraint: A user cannot be assigned to the same role twice.

---

### questions

Blind QA questions generated by AI (FR-010, FR-011).

```typescript
export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** FK to the spec this question belongs to. */
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),

  /** Question text displayed to the PM. */
  text: text('text').notNull(),

  /** Ordered answer options as JSON array of strings (FR-012). Last option is always "Other". */
  options: jsonb('options').$type<string[]>().notNull(),

  /** Sequence order (1-based). Determines display order. */
  sequenceOrder: integer('sequence_order').notNull(),

  /** Slack message timestamp for the Block Kit message. Used for updating UI. */
  slackMessageTs: varchar('slack_message_ts', { length: 64 }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('questions_spec_id_idx').on(table.specId),
  uniqueIndex('questions_spec_order_idx').on(table.specId, table.sequenceOrder),
]);
```

**Validation Rules:**
- `text`: Non-empty string.
- `options`: JSON array with 2-6 string entries. Last entry must be "Other" (FR-012).
- `sequenceOrder`: Positive integer, unique per spec. Range 1 to `spec.totalQuestions`.

---

### answers

PM responses to Blind QA questions (FR-012, FR-013).

```typescript
export const answers = pgTable('answers', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** FK to the question being answered. One answer per question. */
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),

  /** FK to the spec (denormalized for query convenience). */
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),

  /** Index of the selected option (0-based). Null if "Other" with custom text only. */
  selectedOptionIndex: integer('selected_option_index'),

  /** The text of the selected option (denormalized for readability). */
  selectedOptionText: varchar('selected_option_text', { length: 1024 }),

  /** Custom text provided when PM selects "Other" (FR-012). */
  customText: text('custom_text'),

  /** Whether the PM selected the "Other" option. */
  isCustom: boolean('is_custom').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('answers_question_id_idx').on(table.questionId),
  index('answers_spec_id_idx').on(table.specId),
]);
```

**Validation Rules:**
- One answer per question (enforced by unique index on `questionId`).
- If `isCustom` is true, `customText` must be non-empty.
- If `isCustom` is false, `selectedOptionIndex` must be a valid index within the question's options array.
- `selectedOptionText` is populated on write for query convenience (no join needed to display answer summaries).

---

### sessions

Active workflow session tracking (edge case: 24-hour persistence, resume capability).

```typescript
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** FK to the spec being created. One session per spec. */
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),

  /** Slack user ID of the PM driving this session. */
  pmUserId: varchar('pm_user_id', { length: 64 }).notNull(),

  /** Current workflow step within the session. */
  currentStep: sessionStepEnum('current_step').notNull().default('awaiting_description'),

  /** Index of the role currently being populated with members (during selecting_members step). */
  currentRoleIndex: integer('current_role_index').default(0),

  /** Slack channel ID where the session DM / interaction is happening. */
  slackChannelId: varchar('slack_channel_id', { length: 64 }),

  /** Session expiration timestamp. 24 hours from last activity (edge case). */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  /** Whether this session is still active. */
  isActive: boolean('is_active').notNull().default(true),

  /** Ephemeral state data (e.g., pending Slack modal view IDs). */
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('sessions_spec_id_idx').on(table.specId),
  index('sessions_pm_user_id_idx').on(table.pmUserId),
  index('sessions_expires_at_idx').on(table.expiresAt),
  index('sessions_is_active_idx').on(table.isActive),
]);
```

**Validation Rules:**
- One active session per spec (enforced by unique index on `specId`).
- `expiresAt`: Must be set to `NOW() + INTERVAL '24 hours'` on creation and refreshed on each interaction.
- `currentStep`: Must follow valid step transitions (see Session Step Transitions below).
- `currentRoleIndex`: Only relevant when `currentStep` = 'selecting_members'.

---

## Relations

```typescript
// --- Relations ---

export const specsRelations = relations(specs, ({ one, many }) => ({
  channel: one(channels, {
    fields: [specs.id],
    references: [channels.specId],
  }),
  roles: many(specRoles),
  questions: many(questions),
  answers: many(answers),
  session: one(sessions, {
    fields: [specs.id],
    references: [sessions.specId],
  }),
}));

export const channelsRelations = relations(channels, ({ one }) => ({
  spec: one(specs, {
    fields: [channels.specId],
    references: [specs.id],
  }),
}));

export const specRolesRelations = relations(specRoles, ({ one, many }) => ({
  spec: one(specs, {
    fields: [specRoles.specId],
    references: [specs.id],
  }),
  members: many(roleMembers),
}));

export const roleMembersRelations = relations(roleMembers, ({ one }) => ({
  role: one(specRoles, {
    fields: [roleMembers.roleId],
    references: [specRoles.id],
  }),
}));

export const questionsRelations = relations(questions, ({ one }) => ({
  spec: one(specs, {
    fields: [questions.specId],
    references: [specs.id],
  }),
  answer: one(answers, {
    fields: [questions.id],
    references: [answers.questionId],
  }),
}));

export const answersRelations = relations(answers, ({ one }) => ({
  question: one(questions, {
    fields: [answers.questionId],
    references: [questions.id],
  }),
  spec: one(specs, {
    fields: [answers.specId],
    references: [specs.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  spec: one(specs, {
    fields: [sessions.specId],
    references: [specs.id],
  }),
}));
```

---

## State Transitions

### Spec Lifecycle (`spec_state`)

```
drafting ──> questioning ──> generating ──> completed
    │
    └──> abandoned (from any state except completed)
```

| From | To | Trigger |
|------|----|---------|
| `drafting` | `questioning` | Channel created, first question posted (FR-009) |
| `drafting` | `abandoned` | Session timeout (24 hours) or PM cancellation |
| `questioning` | `generating` | All questions answered (FR-014) |
| `questioning` | `abandoned` | Session timeout (24 hours) or PM cancellation |
| `generating` | `completed` | Spec content generated and stored |
| `generating` | `abandoned` | Generation failure after retries |

**Invariant**: `completed` is a terminal state. No transitions out of `completed`.

### Session Step Transitions (`session_step`)

```
awaiting_description ──> analyzing ──> selecting_channel ──> selecting_members ──> confirming ──> creating_channel ──> ready
```

| From | To | Trigger |
|------|----|---------|
| `awaiting_description` | `analyzing` | PM submits feature description (FR-002) |
| `analyzing` | `selecting_channel` | AI returns roles and channel suggestions (FR-003, FR-004) |
| `selecting_channel` | `selecting_members` | PM selects or enters channel name (FR-005) |
| `selecting_members` | `selecting_members` | PM assigns members to current role, advances to next role (FR-006) |
| `selecting_members` | `confirming` | All roles have members assigned |
| `confirming` | `creating_channel` | PM confirms setup |
| `creating_channel` | `ready` | Channel created and members invited (FR-007, FR-008) |

**Note**: When `session.currentStep` reaches `ready`, the spec transitions from `drafting` to `questioning` and the Blind QA phase begins automatically (FR-009).

---

## Indexes Summary

| Table | Index | Type | Purpose |
|-------|-------|------|---------|
| `specs` | `specs_pm_user_id_idx` | btree | Look up specs by PM |
| `specs` | `specs_state_idx` | btree | Filter by lifecycle state |
| `specs` | `specs_created_at_idx` | btree | Sort by creation date |
| `channels` | `channels_spec_id_idx` | unique | One channel per spec |
| `channels` | `channels_slack_channel_id_idx` | unique | Look up by Slack channel |
| `spec_roles` | `spec_roles_spec_id_idx` | btree | List roles for a spec |
| `role_members` | `role_members_role_id_idx` | btree | List members for a role |
| `role_members` | `role_members_role_user_idx` | unique | Prevent duplicate assignment |
| `questions` | `questions_spec_id_idx` | btree | List questions for a spec |
| `questions` | `questions_spec_order_idx` | unique | Enforce order uniqueness |
| `answers` | `answers_question_id_idx` | unique | One answer per question |
| `answers` | `answers_spec_id_idx` | btree | List answers for a spec |
| `sessions` | `sessions_spec_id_idx` | unique | One session per spec |
| `sessions` | `sessions_pm_user_id_idx` | btree | Find active sessions for PM |
| `sessions` | `sessions_expires_at_idx` | btree | Cleanup expired sessions |
| `sessions` | `sessions_is_active_idx` | btree | Filter active sessions |

---

## Drizzle Configuration

```typescript
// drizzle.config.ts (project root)
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

---

## Database Client Setup

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Connection pool size for concurrent sessions (SC-009)
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
```

---

## Key Query Patterns

### Fetch spec with all related data (for spec view page)

```typescript
const spec = await db.query.specs.findFirst({
  where: eq(specs.id, specId),
  with: {
    channel: true,
    roles: {
      with: { members: true },
      orderBy: [asc(specRoles.sortOrder)],
    },
    questions: {
      with: { answer: true },
      orderBy: [asc(questions.sequenceOrder)],
    },
  },
});
```

### Find active session for a PM

```typescript
const activeSession = await db.query.sessions.findFirst({
  where: and(
    eq(sessions.pmUserId, slackUserId),
    eq(sessions.isActive, true),
    gt(sessions.expiresAt, new Date()),
  ),
  with: { spec: true },
});
```

### Get next unanswered question

```typescript
const nextQuestion = await db.query.questions.findFirst({
  where: and(
    eq(questions.specId, specId),
    not(
      inArray(
        questions.id,
        db.select({ id: answers.questionId }).from(answers).where(eq(answers.specId, specId))
      )
    ),
  ),
  orderBy: [asc(questions.sequenceOrder)],
});
```
