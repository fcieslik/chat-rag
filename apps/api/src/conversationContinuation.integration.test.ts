import { Client } from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createConversationRepository } from "./db/conversationRepository.js";
import { runMigrations } from "./db/migrate.js";
import type { GuardrailService } from "./guardrailService.js";
import type { ModelStreamingService } from "./modelStreaming.js";

const migrationDatabaseUrl = process.env.POSTGRES_INTEGRATION_DATABASE_URL;
const applicationDatabaseUrl = process.env.POSTGRES_INTEGRATION_APPLICATION_DATABASE_URL;
const describePostgres = migrationDatabaseUrl && applicationDatabaseUrl ? describe : describe.skip;

const guardrailService: GuardrailService = {
  evaluate: vi.fn().mockResolvedValue({
    action: "NONE",
    detectedTopics: [],
    detectedPii: [],
    detectedContentFilters: [],
    latencyMs: 1,
  }),
};

describePostgres("POST /v1/conversations/:conversationId/messages", () => {
  let migrationClient: Client;
  let repository: ReturnType<typeof createConversationRepository>;

  beforeEach(async () => {
    await runMigrations(migrationDatabaseUrl);
    migrationClient = new Client({ connectionString: migrationDatabaseUrl });
    await migrationClient.connect();
    await migrationClient.query("truncate messages, conversations, users restart identity cascade");
    repository = createConversationRepository(applicationDatabaseUrl);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await repository.close();
    await migrationClient.end();
  });

  it("uses the latest 20 complete Messages in chronological order before the new input", async () => {
    const conversationId = await createConversation("owner");
    for (let index = 1; index <= 21; index += 1) {
      await migrationClient.query(
        "insert into messages (conversation_id, role, status, content, created_at) values ($1, 'system', 'complete', $2, $3)",
        [conversationId, `system-${index}`, `2026-01-01T00:${String(index).padStart(2, "0")}:00Z`],
      );
    }
    const oldUser = await migrationClient.query<{ id: bigint }>(
      "insert into messages (conversation_id, role, status, content, client_message_id, created_at) values ($1, 'user', 'complete', 'old question', '7f9a19a2-e950-4ea2-95a7-63d5910b7edf', '2025-01-01') returning id",
      [conversationId],
    );
    await migrationClient.query(
      "insert into messages (conversation_id, role, status, content, reply_to_message_id, created_at) values ($1, 'assistant', 'error', 'failed answer', $2, '2027-01-01')",
      [conversationId, oldUser.rows[0]!.id],
    );
    const modelStreamingService = streamingService("response");

    const response = await append(conversationId, "owner", modelStreamingService, "new question");

    expect(response.status).toBe(200);
    expect(modelStreamingService.start).toHaveBeenCalledWith({
      messages: [
        ...Array.from({ length: 20 }, (_, index) => ({ role: "system", content: `system-${index + 2}` })),
        { role: "user", content: "new question" },
      ],
      signal: expect.any(AbortSignal),
    });
  });

  it("returns 404 for a foreign Conversation without inserting a Turn", async () => {
    const conversationId = await createConversation("owner");
    const modelStreamingService = streamingService("response");

    const response = await append(conversationId, "other-user", modelStreamingService, "foreign message");

    expect(response).toMatchObject({ status: 404, body: { error: "Conversation not found." } });
    expect(modelStreamingService.start).not.toHaveBeenCalled();
    await expect(
      migrationClient.query("select count(*)::integer as count from messages where conversation_id = $1", [conversationId]),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("rejects a fresh pending response without invoking the model", async () => {
    const conversationId = await createConversation("owner");
    await insertPendingAssistant(conversationId, new Date().toISOString());
    const modelStreamingService = streamingService("response");

    const response = await append(conversationId, "owner", modelStreamingService, "next question");

    expect(response).toMatchObject({ status: 409, body: { error: "A response is already pending." } });
    expect(modelStreamingService.start).not.toHaveBeenCalled();
  });

  it("serializes concurrent sends so only one assistant Message remains pending", async () => {
    const conversationId = await createConversation("owner");
    const input = (clientMessageId: string) => ({
      cognitoSubject: "owner",
      conversationId,
      message: "concurrent question",
      clientMessageId,
      assistantMetadata: { model: "test" },
    });

    const results = await Promise.all([
      repository.appendTurn(input("1f9a19a2-e950-4ea2-95a7-63d5910b7edf")),
      repository.appendTurn(input("2f9a19a2-e950-4ea2-95a7-63d5910b7edf")),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(["created", "pending"]);
    await expect(
      migrationClient.query("select count(*)::integer as count from messages where conversation_id = $1 and role = 'assistant' and status = 'pending'", [conversationId]),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("aborts a stale pending response before accepting the next Turn", async () => {
    const conversationId = await createConversation("owner");
    const pendingAssistantId = await insertPendingAssistant(conversationId, "2000-01-01T00:00:00Z");
    const modelStreamingService = streamingService("response");

    const response = await append(conversationId, "owner", modelStreamingService, "next question");

    expect(response.status).toBe(200);
    await expect(
      migrationClient.query("select status from messages where id = $1", [pendingAssistantId]),
    ).resolves.toMatchObject({ rows: [{ status: "aborted" }] });
  });

  async function createConversation(subject: string): Promise<bigint> {
    const user = await migrationClient.query<{ id: bigint }>(
      "insert into users (cognito_subject) values ($1) returning id",
      [subject],
    );
    const conversation = await migrationClient.query<{ id: bigint }>(
      "insert into conversations (user_id, title) values ($1, 'Conversation') returning id",
      [user.rows[0]!.id],
    );
    return conversation.rows[0]!.id;
  }

  async function insertPendingAssistant(conversationId: bigint, createdAt: string): Promise<bigint> {
    const userMessage = await migrationClient.query<{ id: bigint }>(
      "insert into messages (conversation_id, role, status, content, client_message_id) values ($1, 'user', 'complete', 'previous question', '8f9a19a2-e950-4ea2-95a7-63d5910b7edf') returning id",
      [conversationId],
    );
    const assistant = await migrationClient.query<{ id: bigint }>(
      "insert into messages (conversation_id, role, status, reply_to_message_id, created_at) values ($1, 'assistant', 'pending', $2, $3) returning id",
      [conversationId, userMessage.rows[0]!.id, createdAt],
    );
    return assistant.rows[0]!.id;
  }

  function streamingService(...deltas: string[]): ModelStreamingService {
    return {
      start: vi.fn().mockResolvedValue((async function* () { yield* deltas; })()),
    };
  }

  function append(
    conversationId: bigint,
    subject: string,
    modelStreamingService: ModelStreamingService,
    message: string,
  ) {
    return request(createApp({
      verifyAccessToken: async () => ({ client_id: "client", token_use: "access", sub: subject }),
      guardrailService,
      modelStreamingService,
      conversationRepository: repository,
    }))
      .post(`/v1/conversations/${conversationId}/messages`)
      .set("Authorization", "Bearer token")
      .send({ message, clientMessageId: "9f9a19a2-e950-4ea2-95a7-63d5910b7edf" });
  }
});
