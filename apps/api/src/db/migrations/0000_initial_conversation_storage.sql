CREATE TYPE "public"."message_role" AS ENUM ('user', 'assistant', 'system');
--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM ('pending', 'complete', 'error', 'aborted');
--> statement-breakpoint
CREATE TABLE "users" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "cognito_subject" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversations" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "user_id" bigint NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "activity_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
  "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "conversation_id" bigint NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "role" "message_role" NOT NULL,
  "status" "message_status" NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "client_message_id" uuid,
  "reply_to_message_id" bigint REFERENCES "messages"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "messages_role_status_check" CHECK ("role" = 'assistant' OR "status" = 'complete'),
  CONSTRAINT "messages_role_shape_check" CHECK (
    ("role" = 'user' AND "client_message_id" IS NOT NULL AND "reply_to_message_id" IS NULL)
    OR ("role" = 'assistant' AND "client_message_id" IS NULL AND "reply_to_message_id" IS NOT NULL)
    OR ("role" = 'system' AND "client_message_id" IS NULL AND "reply_to_message_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "conversations_active_by_user_idx" ON "conversations" ("user_id", "activity_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_message_id_unique" ON "messages" ("client_message_id") WHERE "client_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "messages_assistant_reply_unique" ON "messages" ("reply_to_message_id") WHERE "role" = 'assistant';
--> statement-breakpoint
CREATE UNIQUE INDEX "messages_one_pending_assistant_per_conversation" ON "messages" ("conversation_id") WHERE "role" = 'assistant' AND "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "messages_by_conversation_created_idx" ON "messages" ("conversation_id", "created_at", "id");
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO chat_rag_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users, conversations, messages TO chat_rag_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chat_rag_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO chat_rag_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO chat_rag_app;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM chat_rag_app;
