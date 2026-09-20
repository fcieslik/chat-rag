import {
  bigint,
  type AnyPgColumn,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const messageRole = pgEnum("message_role", ["user", "assistant", "system"]);
export const messageStatus = pgEnum("message_status", ["pending", "complete", "error", "aborted"]);

export const users = pgTable("users", {
  id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
  cognitoSubject: text("cognito_subject").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    userId: bigint("user_id", { mode: "bigint" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    activityAt: timestamp("activity_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("conversations_active_by_user_idx")
      .on(table.userId, table.activityAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    conversationId: bigint("conversation_id", { mode: "bigint" })
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    status: messageStatus("status").notNull(),
    content: text("content").default("").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    clientMessageId: uuid("client_message_id"),
    replyToMessageId: bigint("reply_to_message_id", { mode: "bigint" }).references(
      (): AnyPgColumn => messages.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("messages_client_message_id_unique")
      .on(table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    uniqueIndex("messages_assistant_reply_unique")
      .on(table.replyToMessageId)
      .where(sql`${table.role} = 'assistant'`),
    uniqueIndex("messages_one_pending_assistant_per_conversation")
      .on(table.conversationId)
      .where(sql`${table.role} = 'assistant' and ${table.status} = 'pending'`),
    index("messages_by_conversation_created_idx").on(table.conversationId, table.createdAt, table.id),
    check(
      "messages_role_status_check",
      sql`(${table.role} = 'assistant') or (${table.status} = 'complete')`,
    ),
    check(
      "messages_role_shape_check",
      sql`(${table.role} = 'user' and ${table.clientMessageId} is not null and ${table.replyToMessageId} is null)
        or (${table.role} = 'assistant' and ${table.clientMessageId} is null and ${table.replyToMessageId} is not null)
        or (${table.role} = 'system' and ${table.clientMessageId} is null and ${table.replyToMessageId} is null)`,
    ),
  ],
);
