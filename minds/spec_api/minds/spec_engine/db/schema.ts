/**
 * Drizzle ORM schema for PM Workflow in Slack
 * Defines 7 tables with enums, indexes, and relations
 */

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

/** Spec lifecycle states */
export const specStateEnum = pgEnum('spec_state', [
  'drafting',       // PM is providing description, selecting channel/roles
  'questioning',    // Blind QA in progress
  'generating',     // AI is generating the final spec document
  'completed',      // Spec generated and viewable
  'abandoned',      // Session timed out or PM explicitly cancelled
]);

/** Session workflow steps within the drafting phase */
export const sessionStepEnum = pgEnum('session_step', [
  'awaiting_description',   // Waiting for feature description input
  'analyzing',              // AI analyzing description for roles
  'selecting_channel',      // PM choosing channel name
  'selecting_members',      // PM assigning members to roles (sequential)
  'confirming',             // PM confirming before channel creation
  'creating_channel',       // System creating Slack channel
  'ready',                  // Channel created, ready for Blind QA
]);

// --- Table Definitions ---

export const specs = pgTable('specs', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  state: specStateEnum('state').notNull().default('drafting'),
  pmUserId: varchar('pm_user_id', { length: 64 }).notNull(),
  pmDisplayName: varchar('pm_display_name', { length: 255 }),
  complexityScore: integer('complexity_score'),
  totalQuestions: integer('total_questions'),
  answeredQuestions: integer('answered_questions').notNull().default(0),
  content: text('content'),
  contentHtml: text('content_html'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('specs_pm_user_id_idx').on(table.pmUserId),
  index('specs_state_idx').on(table.state),
  index('specs_created_at_idx').on(table.createdAt),
]);

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),
  slackChannelId: varchar('slack_channel_id', { length: 64 }).notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  nameSuggestions: jsonb('name_suggestions').$type<string[]>(),
  isCustomName: boolean('is_custom_name').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('channels_spec_id_idx').on(table.specId),
  uniqueIndex('channels_slack_channel_id_idx').on(table.slackChannelId),
]);

export const specRoles = pgTable('spec_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  rationale: text('rationale'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('spec_roles_spec_id_idx').on(table.specId),
]);

export const roleMembers = pgTable('role_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  roleId: uuid('role_id').notNull().references(() => specRoles.id, { onDelete: 'cascade' }),
  slackUserId: varchar('slack_user_id', { length: 64 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('role_members_role_id_idx').on(table.roleId),
  uniqueIndex('role_members_role_user_idx').on(table.roleId, table.slackUserId),
]);

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  options: jsonb('options').$type<string[]>().notNull(),
  sequenceOrder: integer('sequence_order').notNull(),
  slackMessageTs: varchar('slack_message_ts', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('questions_spec_id_idx').on(table.specId),
  uniqueIndex('questions_spec_order_idx').on(table.specId, table.sequenceOrder),
]);

export const answers = pgTable('answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: uuid('question_id').notNull().references(() => questions.id, { onDelete: 'cascade' }),
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),
  selectedOptionIndex: integer('selected_option_index'),
  selectedOptionText: varchar('selected_option_text', { length: 1024 }),
  customText: text('custom_text'),
  isCustom: boolean('is_custom').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('answers_question_id_idx').on(table.questionId),
  index('answers_spec_id_idx').on(table.specId),
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  specId: uuid('spec_id').notNull().references(() => specs.id, { onDelete: 'cascade' }),
  pmUserId: varchar('pm_user_id', { length: 64 }).notNull(),
  currentStep: sessionStepEnum('current_step').notNull().default('awaiting_description'),
  currentRoleIndex: integer('current_role_index').default(0),
  slackChannelId: varchar('slack_channel_id', { length: 64 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('sessions_spec_id_idx').on(table.specId),
  index('sessions_pm_user_id_idx').on(table.pmUserId),
  index('sessions_expires_at_idx').on(table.expiresAt),
  index('sessions_is_active_idx').on(table.isActive),
]);

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
