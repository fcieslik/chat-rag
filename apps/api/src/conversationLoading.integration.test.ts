import { Client } from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createConversationRepository } from "./db/conversationRepository.js";
import { runMigrations } from "./db/migrate.js";

const migrationDatabaseUrl = process.env.POSTGRES_INTEGRATION_DATABASE_URL;
const applicationDatabaseUrl = process.env.POSTGRES_INTEGRATION_APPLICATION_DATABASE_URL;
const describePostgres = migrationDatabaseUrl && applicationDatabaseUrl ? describe : describe.skip;

describePostgres("GET owned Conversations", () => {
  let migrationClient: Client;
  let repository: ReturnType<typeof createConversationRepository>;

  beforeEach(async () => {
    await runMigrations(migrationDatabaseUrl);
    migrationClient = new Client({ connectionString: migrationDatabaseUrl });
    await migrationClient.connect();
    await migrationClient.query("truncate messages, conversations, users restart identity cascade");
    repository = createConversationRepository(applicationDatabaseUrl);
  });

  afterEach(async () => {
    await repository.close();
    await migrationClient.end();
  });

  it("isolates lists, Conversation lookups, and Message lookups between Users", async () => {
    const users = await migrationClient.query<{ id: bigint }>(
      "insert into users (cognito_subject) values ('user-one'), ('user-two') returning id",
    );
    const conversations = await migrationClient.query<{ id: bigint }>(
      "insert into conversations (user_id, title, activity_at) values ($1, 'Older', '2026-01-01'), ($1, 'Newest', '2026-01-02'), ($2, 'Foreign', '2026-01-03') returning id",
      [users.rows[0]!.id, users.rows[1]!.id],
    );
    const userMessage = await migrationClient.query<{ id: bigint }>(
      "insert into messages (conversation_id, role, status, content, client_message_id) values ($1, 'user', 'complete', 'Stored question', 'b23e4567-e89b-42d3-a456-426614174000') returning id",
      [conversations.rows[1]!.id],
    );
    await migrationClient.query(
      "insert into messages (conversation_id, role, status, content, reply_to_message_id, metadata) values ($1, 'assistant', 'complete', 'Stored answer', $2, '{\"model\":\"test\"}')",
      [conversations.rows[1]!.id, userMessage.rows[0]!.id],
    );

    const app = createApp({
      verifyAccessToken: async (token) => ({ client_id: "client", token_use: "access", sub: token }),
      conversationRepository: repository,
    });
    const own = (path: string) => request(app).get(path).set("Authorization", "Bearer user-one");

    await expect(own("/v1/conversations")).resolves.toMatchObject({
      status: 200,
      body: { conversations: [{ id: conversations.rows[1]!.id.toString(), title: "Newest" }, { title: "Older" }] },
    });
    await expect(own(`/v1/conversations/${conversations.rows[1]!.id}/messages`)).resolves.toMatchObject({
      status: 200,
      body: { messages: [
        { role: "user", status: "complete", content: "Stored question" },
        { role: "assistant", status: "complete", content: "Stored answer", metadata: { model: "test" }, replyToMessageId: userMessage.rows[0]!.id.toString() },
      ] },
    });

    for (const path of [
      `/v1/conversations/${conversations.rows[2]!.id}`,
      `/v1/conversations/${conversations.rows[2]!.id}/messages`,
      "/v1/conversations/not-an-id",
      "/v1/conversations/999999/messages",
    ]) {
      await expect(own(path)).resolves.toMatchObject({ status: 404, body: { error: "Conversation not found." } });
    }
  });

  it("pages Conversations and Messages by stable timestamp and identity keysets", async () => {
    const user = await migrationClient.query<{ id: bigint }>(
      "insert into users (cognito_subject) values ('user-one') returning id",
    );
    const conversation = await migrationClient.query<{ id: bigint }>(
      "insert into conversations (user_id, title, activity_at) values ($1, 'History', '2026-01-01') returning id",
      [user.rows[0]!.id],
    );
    await migrationClient.query(
      "insert into conversations (user_id, title, activity_at) select $1, 'Conversation ' || value, '2026-02-01' from generate_series(1, 21) value",
      [user.rows[0]!.id],
    );
    await migrationClient.query(
      "insert into messages (conversation_id, role, status, content, client_message_id, created_at) select $1, 'user', 'complete', 'Message ' || value, ('00000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid, '2026-03-01' from generate_series(1, 51) value",
      [conversation.rows[0]!.id],
    );

    const app = createApp({
      verifyAccessToken: async (token) => ({ client_id: "client", token_use: "access", sub: token }),
      conversationRepository: repository,
    });
    const own = (path: string) => request(app).get(path).set("Authorization", "Bearer user-one");

    const firstConversations = await own("/v1/conversations");
    expect(firstConversations.body.conversations).toHaveLength(20);
    expect(firstConversations.body.nextCursor).toEqual(expect.any(String));
    const secondConversations = await own(`/v1/conversations?cursor=${encodeURIComponent(firstConversations.body.nextCursor)}`);
    expect(secondConversations.body.conversations).toHaveLength(2);
    expect(secondConversations.body.nextCursor).toBeUndefined();
    expect(new Set([
      ...firstConversations.body.conversations,
      ...secondConversations.body.conversations,
    ].map((storedConversation) => storedConversation.id))).toHaveLength(22);
    await expect(own("/v1/conversations?limit=100")).resolves.toMatchObject({
      status: 200,
      body: { conversations: expect.arrayContaining([{ title: "History" }]) },
    });

    const messagesPath = `/v1/conversations/${conversation.rows[0]!.id}/messages`;
    const newestMessages = await own(messagesPath);
    expect(newestMessages.body.messages).toHaveLength(50);
    expect(newestMessages.body.messages.map((message) => message.content)).toEqual(
      Array.from({ length: 50 }, (_, index) => `Message ${index + 2}`),
    );
    const olderMessages = await own(`${messagesPath}?cursor=${encodeURIComponent(newestMessages.body.nextCursor)}`);
    expect(olderMessages.body.messages.map((message) => message.content)).toEqual(["Message 1"]);
    expect(olderMessages.body.nextCursor).toBeUndefined();
    await expect(own(`${messagesPath}?limit=100`)).resolves.toMatchObject({
      status: 200,
      body: { messages: expect.arrayContaining([{ content: "Message 1" }]) },
    });

    for (const path of ["/v1/conversations?limit=101", "/v1/conversations?limit=0", `${messagesPath}?limit=not-a-number`]) {
      await expect(own(path)).resolves.toMatchObject({
      status: 400,
      body: { error: "Invalid pagination parameters." },
      });
    }
    await expect(own("/v1/conversations?cursor=invalid")).resolves.toMatchObject({
      status: 400,
      body: { error: "Invalid pagination parameters." },
    });
  });
});
