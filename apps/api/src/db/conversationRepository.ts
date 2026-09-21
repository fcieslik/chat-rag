import { type Pool, type PoolClient } from "pg";
import type { ModelMessage } from "../modelStreaming.js";
import { createDatabasePool } from "./databaseRuntime.js";

export interface CreatedFirstTurn {
  conversationId: bigint;
  userMessageId: bigint;
  assistantMessageId: bigint;
}

export type IdempotentTurnResult =
  | { kind: "missing" }
  | { kind: "foreign" }
  | { kind: "incomplete" }
  | { kind: "complete"; turn: CreatedFirstTurn; content: string };

export type CreateFirstTurnResult =
  | { kind: "created"; turn: CreatedFirstTurn }
  | Exclude<IdempotentTurnResult, { kind: "missing" }>;

export type AppendTurnResult =
  | { kind: "not_found" }
  | { kind: "pending" }
  | { kind: "created"; turn: CreatedFirstTurn; context: ModelMessage[] }
  | Exclude<IdempotentTurnResult, { kind: "missing" }>;

export interface StoredConversation {
  id: bigint;
  title: string | null;
  createdAt: Date;
  activityAt: Date;
}

export interface StoredMessage {
  id: bigint;
  role: "user" | "assistant" | "system";
  status: "pending" | "complete" | "error" | "aborted";
  content: string;
  metadata: Record<string, unknown>;
  replyToMessageId: bigint | null;
  createdAt: Date;
}

export interface HistoryCursor {
  timestamp: Date;
  id: bigint;
}

export interface PageRequest {
  limit: number;
  cursor?: HistoryCursor;
}

export interface ConversationPage {
  conversations: StoredConversation[];
  nextCursor?: HistoryCursor;
}

export interface MessagePage {
  messages: StoredMessage[];
  nextCursor?: HistoryCursor;
}

export interface ConversationRepository {
  findTurnByClientMessageId(
    cognitoSubject: string,
    clientMessageId: string,
  ): Promise<IdempotentTurnResult>;
  createFirstTurn(input: {
    cognitoSubject: string;
    message: string;
    clientMessageId: string;
    assistantMetadata: Record<string, string>;
  }): Promise<CreateFirstTurnResult>;
  appendTurn(input: {
    cognitoSubject: string;
    conversationId: bigint;
    message: string;
    clientMessageId: string;
    assistantMetadata: Record<string, string>;
  }): Promise<AppendTurnResult>;
  finishAssistantMessage(
    assistantMessageId: bigint,
    status: "complete" | "error" | "aborted",
    content: string,
  ): Promise<void>;
  listOwnedConversations(cognitoSubject: string, page: PageRequest): Promise<ConversationPage>;
  getOwnedConversation(cognitoSubject: string, conversationId: bigint): Promise<StoredConversation | undefined>;
  listOwnedMessages(
    cognitoSubject: string,
    conversationId: bigint,
    page: PageRequest,
  ): Promise<MessagePage | undefined>;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export function createConversationRepository(
  databaseUrl = process.env.DATABASE_URL,
  pool: Pool = createDatabasePool(databaseUrl),
): ConversationRepository {
  return {
    async findTurnByClientMessageId(cognitoSubject, clientMessageId) {
      return lookupTurn(pool, cognitoSubject, clientMessageId);
    },

    async createFirstTurn(input) {
      const client = await pool.connect();

      try {
        await client.query("begin");
        const existingTurn = await lookupTurn(client, input.cognitoSubject, input.clientMessageId);
        if (existingTurn.kind !== "missing") {
          await client.query("commit");
          return existingTurn;
        }
        const userId = await resolveUserId(client, input.cognitoSubject);
        const conversation = await client.query<{ id: bigint }>(
          "insert into conversations (user_id, title) values ($1, $2) returning id",
          [userId, input.message.slice(0, 80)],
        );
        const conversationId = conversation.rows[0]!.id;
        const userMessage = await client.query<{ id: bigint }>(
          "insert into messages (conversation_id, role, status, content, client_message_id) values ($1, 'user', 'complete', $2, $3) returning id",
          [conversationId, input.message, input.clientMessageId],
        );
        const userMessageId = userMessage.rows[0]!.id;
        const assistantMessage = await client.query<{ id: bigint }>(
          "insert into messages (conversation_id, role, status, reply_to_message_id, metadata) values ($1, 'assistant', 'pending', $2, $3::jsonb) returning id",
          [conversationId, userMessageId, JSON.stringify(input.assistantMetadata)],
        );
        await client.query("update conversations set activity_at = now() where id = $1", [
          conversationId,
        ]);
        await client.query("commit");

        return {
          kind: "created",
          turn: {
            conversationId,
            userMessageId,
            assistantMessageId: assistantMessage.rows[0]!.id,
          },
        };
      } catch (error) {
        await client.query("rollback");
        if (isUniqueViolation(error)) {
          const existingTurn = await lookupTurn(pool, input.cognitoSubject, input.clientMessageId);
          if (existingTurn.kind !== "missing") {
            return existingTurn;
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async finishAssistantMessage(assistantMessageId, status, content) {
      await pool.query(
        "update messages set status = $2, content = $3 where id = $1 and status = 'pending'",
        [assistantMessageId, status, content],
      );
    },

    async appendTurn(input) {
      const client = await pool.connect();

      try {
        await client.query("begin");
        const existingTurn = await lookupTurn(client, input.cognitoSubject, input.clientMessageId);
        if (existingTurn.kind !== "missing") {
          await client.query("commit");
          return existingTurn;
        }
        const conversation = await client.query<{ id: bigint }>(
          "select c.id from conversations c join users u on u.id = c.user_id where u.cognito_subject = $1 and c.id = $2 and c.deleted_at is null for update",
          [input.cognitoSubject, input.conversationId],
        );
        if (!conversation.rows[0]) {
          await client.query("commit");
          return { kind: "not_found" };
        }

        const lockedExistingTurn = await lookupTurn(
          client,
          input.cognitoSubject,
          input.clientMessageId,
        );
        if (lockedExistingTurn.kind !== "missing") {
          await client.query("commit");
          return lockedExistingTurn;
        }

        await client.query(
          "update messages set status = 'aborted' where conversation_id = $1 and role = 'assistant' and status = 'pending' and created_at < now() - interval '10 minutes'",
          [input.conversationId],
        );
        const pendingAssistant = await client.query(
          "select 1 from messages where conversation_id = $1 and role = 'assistant' and status = 'pending' limit 1",
          [input.conversationId],
        );
        if (pendingAssistant.rows[0]) {
          await client.query("commit");
          return { kind: "pending" };
        }

        const persistedMessages = await client.query<ModelMessage>(
          "select role, content from (select role, content, created_at, id from messages where conversation_id = $1 and status = 'complete' order by created_at desc, id desc limit 20) recent order by created_at asc, id asc",
          [input.conversationId],
        );
        const userMessage = await client.query<{ id: bigint }>(
          "insert into messages (conversation_id, role, status, content, client_message_id) values ($1, 'user', 'complete', $2, $3) returning id",
          [input.conversationId, input.message, input.clientMessageId],
        );
        const assistantMessage = await client.query<{ id: bigint }>(
          "insert into messages (conversation_id, role, status, reply_to_message_id, metadata) values ($1, 'assistant', 'pending', $2, $3::jsonb) returning id",
          [input.conversationId, userMessage.rows[0]!.id, JSON.stringify(input.assistantMetadata)],
        );
        await client.query("update conversations set activity_at = now() where id = $1", [
          input.conversationId,
        ]);
        await client.query("commit");

        return {
          kind: "created",
          turn: {
            conversationId: input.conversationId,
            userMessageId: userMessage.rows[0]!.id,
            assistantMessageId: assistantMessage.rows[0]!.id,
          },
          context: [...persistedMessages.rows, { role: "user", content: input.message }],
        };
      } catch (error) {
        await client.query("rollback");
        if (isUniqueViolation(error)) {
          const existingTurn = await lookupTurn(pool, input.cognitoSubject, input.clientMessageId);
          if (existingTurn.kind !== "missing") {
            return existingTurn;
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async listOwnedConversations(cognitoSubject, page) {
      const cursorFilter = page.cursor
        ? "and (c.activity_at, c.id) < ($2, $3)"
        : "";
      const result = await pool.query<StoredConversation>(
        `select c.id, c.title, c.created_at as "createdAt", c.activity_at as "activityAt"
         from conversations c join users u on u.id = c.user_id
         where u.cognito_subject = $1 and c.deleted_at is null ${cursorFilter}
         order by c.activity_at desc, c.id desc limit $${page.cursor ? 4 : 2}`,
        page.cursor
          ? [cognitoSubject, page.cursor.timestamp, page.cursor.id, page.limit + 1]
          : [cognitoSubject, page.limit + 1],
      );
      const conversations = result.rows.slice(0, page.limit);
      const lastConversation = conversations.at(-1);
      return {
        conversations,
        ...(result.rows.length > page.limit && lastConversation
          ? { nextCursor: { timestamp: lastConversation.activityAt, id: lastConversation.id } }
          : {}),
      };
    },

    async getOwnedConversation(cognitoSubject, conversationId) {
      const result = await pool.query<StoredConversation>(
        "select c.id, c.title, c.created_at as \"createdAt\", c.activity_at as \"activityAt\" from conversations c join users u on u.id = c.user_id where u.cognito_subject = $1 and c.id = $2 and c.deleted_at is null",
        [cognitoSubject, conversationId],
      );
      return result.rows[0];
    },

    async listOwnedMessages(cognitoSubject, conversationId, page) {
      const conversation = await pool.query<{ id: bigint }>(
        "select c.id from conversations c join users u on u.id = c.user_id where u.cognito_subject = $1 and c.id = $2 and c.deleted_at is null",
        [cognitoSubject, conversationId],
      );
      if (!conversation.rows[0]) {
        return undefined;
      }
      const cursorFilter = page.cursor
        ? "and (m.created_at, m.id) < ($2, $3)"
        : "";
      const result = await pool.query<StoredMessage>(
        `select m.id, m.role, m.status, m.content, m.metadata,
                m.reply_to_message_id as "replyToMessageId", m.created_at as "createdAt"
         from messages m
         where m.conversation_id = $1 ${cursorFilter}
         order by m.created_at desc, m.id desc limit $${page.cursor ? 4 : 2}`,
        page.cursor
          ? [conversationId, page.cursor.timestamp, page.cursor.id, page.limit + 1]
          : [conversationId, page.limit + 1],
      );
      const newestFirstMessages = result.rows.slice(0, page.limit);
      const oldestMessage = newestFirstMessages.at(-1);
      return {
        messages: newestFirstMessages.reverse(),
        ...(result.rows.length > page.limit && oldestMessage
          ? { nextCursor: { timestamp: oldestMessage.createdAt, id: oldestMessage.id } }
          : {}),
      };
    },

    async ready() {
      await pool.query("select 1");
    },

    async close() {
      await pool.end();
    },
  };
}

async function lookupTurn(
  queryable: Pick<Pool, "query"> | PoolClient,
  cognitoSubject: string,
  clientMessageId: string,
): Promise<IdempotentTurnResult> {
  const result = await queryable.query<{
    conversationId: bigint;
    ownerSubject: string;
    userMessageId: bigint;
    assistantMessageId: bigint;
    assistantStatus: "pending" | "complete" | "error" | "aborted";
    assistantContent: string;
  }>(
    `select c.id as "conversationId", u.cognito_subject as "ownerSubject", user_message.id as "userMessageId", assistant_message.id as "assistantMessageId", assistant_message.status as "assistantStatus", assistant_message.content as "assistantContent"
     from messages user_message
     join conversations c on c.id = user_message.conversation_id
     join users u on u.id = c.user_id
     join messages assistant_message on assistant_message.reply_to_message_id = user_message.id and assistant_message.role = 'assistant'
     where user_message.client_message_id = $1`,
    [clientMessageId],
  );
  const storedTurn = result.rows[0];
  if (!storedTurn) {
    return { kind: "missing" };
  }
  if (storedTurn.ownerSubject !== cognitoSubject) {
    return { kind: "foreign" };
  }
  if (storedTurn.assistantStatus !== "complete") {
    return { kind: "incomplete" };
  }
  return {
    kind: "complete",
    turn: {
      conversationId: storedTurn.conversationId,
      userMessageId: storedTurn.userMessageId,
      assistantMessageId: storedTurn.assistantMessageId,
    },
    content: storedTurn.assistantContent,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

async function resolveUserId(client: PoolClient, cognitoSubject: string): Promise<bigint> {
  const inserted = await client.query<{ id: bigint }>(
    "insert into users (cognito_subject) values ($1) on conflict (cognito_subject) do nothing returning id",
    [cognitoSubject],
  );

  if (inserted.rows[0]) {
    return inserted.rows[0].id;
  }

  const existing = await client.query<{ id: bigint }>(
    "select id from users where cognito_subject = $1",
    [cognitoSubject],
  );
  return existing.rows[0]!.id;
}
