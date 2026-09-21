import { Pool, type PoolClient } from "pg";
import type { ModelMessage } from "../modelStreaming.js";

export interface CreatedFirstTurn {
  conversationId: bigint;
  userMessageId: bigint;
  assistantMessageId: bigint;
}

export type AppendTurnResult =
  | { kind: "not_found" }
  | { kind: "pending" }
  | { kind: "created"; turn: CreatedFirstTurn; context: ModelMessage[] };

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

export interface ConversationRepository {
  createFirstTurn(input: {
    cognitoSubject: string;
    message: string;
    clientMessageId: string;
    assistantMetadata: Record<string, string>;
  }): Promise<CreatedFirstTurn>;
  appendTurn(input: {
    cognitoSubject: string;
    conversationId: bigint;
    message: string;
    clientMessageId: string;
    assistantMetadata: Record<string, string>;
  }): Promise<AppendTurnResult>;
  completeAssistantMessage(assistantMessageId: bigint, content: string): Promise<void>;
  listOwnedConversations(cognitoSubject: string): Promise<StoredConversation[]>;
  getOwnedConversation(cognitoSubject: string, conversationId: bigint): Promise<StoredConversation | undefined>;
  listOwnedMessages(cognitoSubject: string, conversationId: bigint): Promise<StoredMessage[] | undefined>;
  close(): Promise<void>;
}

export function createConversationRepository(
  databaseUrl = process.env.DATABASE_URL,
): ConversationRepository {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return {
    async createFirstTurn(input) {
      const client = await pool.connect();

      try {
        await client.query("begin");
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
          conversationId,
          userMessageId,
          assistantMessageId: assistantMessage.rows[0]!.id,
        };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async completeAssistantMessage(assistantMessageId, content) {
      await pool.query(
        "update messages set status = 'complete', content = $2 where id = $1 and status = 'pending'",
        [assistantMessageId, content],
      );
    },

    async appendTurn(input) {
      const client = await pool.connect();

      try {
        await client.query("begin");
        const conversation = await client.query<{ id: bigint }>(
          "select c.id from conversations c join users u on u.id = c.user_id where u.cognito_subject = $1 and c.id = $2 and c.deleted_at is null for update",
          [input.cognitoSubject, input.conversationId],
        );
        if (!conversation.rows[0]) {
          await client.query("commit");
          return { kind: "not_found" };
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
        throw error;
      } finally {
        client.release();
      }
    },

    async listOwnedConversations(cognitoSubject) {
      const result = await pool.query<StoredConversation>(
        "select c.id, c.title, c.created_at as \"createdAt\", c.activity_at as \"activityAt\" from conversations c join users u on u.id = c.user_id where u.cognito_subject = $1 and c.deleted_at is null order by c.activity_at desc, c.id desc limit 20",
        [cognitoSubject],
      );
      return result.rows;
    },

    async getOwnedConversation(cognitoSubject, conversationId) {
      const result = await pool.query<StoredConversation>(
        "select c.id, c.title, c.created_at as \"createdAt\", c.activity_at as \"activityAt\" from conversations c join users u on u.id = c.user_id where u.cognito_subject = $1 and c.id = $2 and c.deleted_at is null",
        [cognitoSubject, conversationId],
      );
      return result.rows[0];
    },

    async listOwnedMessages(cognitoSubject, conversationId) {
      const result = await pool.query<StoredMessage & { conversation_id: bigint }>(
        "select m.id, m.role, m.status, m.content, m.metadata, m.reply_to_message_id as \"replyToMessageId\", m.created_at as \"createdAt\" from conversations c join users u on u.id = c.user_id left join messages m on m.conversation_id = c.id where u.cognito_subject = $1 and c.id = $2 and c.deleted_at is null order by m.created_at asc nulls first, m.id asc nulls first",
        [cognitoSubject, conversationId],
      );
      if (result.rowCount === 0) {
        return undefined;
      }
      return result.rows.filter((message) => message.id !== null);
    },

    async close() {
      await pool.end();
    },
  };
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
