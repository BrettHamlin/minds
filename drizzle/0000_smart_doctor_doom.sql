CREATE TYPE "public"."session_step" AS ENUM('awaiting_description', 'analyzing', 'selecting_channel', 'selecting_members', 'confirming', 'creating_channel', 'ready');--> statement-breakpoint
CREATE TYPE "public"."spec_state" AS ENUM('drafting', 'questioning', 'generating', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"spec_id" uuid NOT NULL,
	"selected_option_index" integer,
	"selected_option_text" varchar(1024),
	"custom_text" text,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_id" uuid NOT NULL,
	"slack_channel_id" varchar(64) NOT NULL,
	"name" varchar(80) NOT NULL,
	"name_suggestions" jsonb,
	"is_custom_name" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_id" uuid NOT NULL,
	"text" text NOT NULL,
	"options" jsonb NOT NULL,
	"sequence_order" integer NOT NULL,
	"slack_message_ts" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"slack_user_id" varchar(64) NOT NULL,
	"display_name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_id" uuid NOT NULL,
	"pm_user_id" varchar(64) NOT NULL,
	"current_step" "session_step" DEFAULT 'awaiting_description' NOT NULL,
	"current_role_index" integer DEFAULT 0,
	"slack_channel_id" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_id" uuid NOT NULL,
	"name" varchar(128) NOT NULL,
	"rationale" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"state" "spec_state" DEFAULT 'drafting' NOT NULL,
	"pm_user_id" varchar(64) NOT NULL,
	"pm_display_name" varchar(255),
	"complexity_score" integer,
	"total_questions" integer,
	"answered_questions" integer DEFAULT 0 NOT NULL,
	"content" text,
	"content_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_spec_id_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_spec_id_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_spec_id_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_members" ADD CONSTRAINT "role_members_role_id_spec_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."spec_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_spec_id_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_roles" ADD CONSTRAINT "spec_roles_spec_id_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "public"."specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_question_id_idx" ON "answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "answers_spec_id_idx" ON "answers" USING btree ("spec_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_spec_id_idx" ON "channels" USING btree ("spec_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_slack_channel_id_idx" ON "channels" USING btree ("slack_channel_id");--> statement-breakpoint
CREATE INDEX "questions_spec_id_idx" ON "questions" USING btree ("spec_id");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_spec_order_idx" ON "questions" USING btree ("spec_id","sequence_order");--> statement-breakpoint
CREATE INDEX "role_members_role_id_idx" ON "role_members" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_members_role_user_idx" ON "role_members" USING btree ("role_id","slack_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_spec_id_idx" ON "sessions" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "sessions_pm_user_id_idx" ON "sessions" USING btree ("pm_user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_is_active_idx" ON "sessions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "spec_roles_spec_id_idx" ON "spec_roles" USING btree ("spec_id");--> statement-breakpoint
CREATE INDEX "specs_pm_user_id_idx" ON "specs" USING btree ("pm_user_id");--> statement-breakpoint
CREATE INDEX "specs_state_idx" ON "specs" USING btree ("state");--> statement-breakpoint
CREATE INDEX "specs_created_at_idx" ON "specs" USING btree ("created_at");