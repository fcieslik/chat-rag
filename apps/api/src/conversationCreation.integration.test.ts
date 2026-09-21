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

const modelStreamingService: ModelStreamingService = {
  start: vi.fn().mockImplementation(async () =>
    (async function* () {
      yield "Hello";
      yield " world";
    })(),
  ),
};

describePostgres("POST /v1/conversations", () => {
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

  it("persists an accepted first Turn and streams its identifiers before deltas", async () => {
    const response = await request(
      createApp({
        verifyAccessToken: vi.fn().mockResolvedValue({
          client_id: "client-123",
          token_use: "access",
          sub: "cognito-user-1",
        }),
        guardrailService,
        modelStreamingService,
        conversationRepository: repository,
      }),
    )
      .post("/v1/conversations")
      .set("Authorization", "Bearer valid-token")
      .send({
        message: "  First persisted message  ",
        clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      });

    expect(response.status).toBe(200);
    expect(response.text).toMatch(
      /^event: turn\.started\ndata: \{"conversationId":"\d+","userMessageId":"\d+","assistantMessageId":"\d+"\}\n\nevent: response\.delta\ndata: \{"delta":"Hello"\}\n\nevent: response\.delta\ndata: \{"delta":" world"\}\n\nevent: response\.completed\ndata: \{\}\n\n$/,
    );
    expect(modelStreamingService.start).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "First persisted message" }],
      signal: expect.any(AbortSignal),
    });
    await expect(
      migrationClient.query(
        "select c.title, u.cognito_subject, user_message.content as user_content, assistant_message.content as assistant_content, assistant_message.status from conversations c join users u on u.id = c.user_id join messages user_message on user_message.conversation_id = c.id and user_message.role = 'user' join messages assistant_message on assistant_message.reply_to_message_id = user_message.id",
      ),
    ).resolves.toMatchObject({
      rows: [{
        title: "First persisted message",
        cognito_subject: "cognito-user-1",
        user_content: "First persisted message",
        assistant_content: "Hello world",
        status: "complete",
      }],
    });
  });

  it("persists an error Message with partial output when the provider fails after streaming", async () => {
    const failingStreamingService: ModelStreamingService = {
      start: vi.fn().mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield "Partial answer";
          throw new Error("provider unavailable");
        },
      }),
    };

    const response = await request(createApp({
      verifyAccessToken: vi.fn().mockResolvedValue({ client_id: "client-123", token_use: "access", sub: "cognito-user-1" }),
      guardrailService,
      modelStreamingService: failingStreamingService,
      conversationRepository: repository,
    }))
      .post("/v1/conversations")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "First persisted message", clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf" });

    expect(response.status).toBe(200);
    expect(response.text).toContain('event: response.failed\ndata: {"error":"Streaming failed."}');
    await expect(
      migrationClient.query("select status, content from messages where role = 'assistant'"),
    ).resolves.toMatchObject({ rows: [{ status: "error", content: "Partial answer" }] });
  });

  it("persists an error Message before SSE headers when the provider cannot start", async () => {
    const failingStreamingService: ModelStreamingService = {
      start: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };

    const response = await request(createApp({
      verifyAccessToken: vi.fn().mockResolvedValue({ client_id: "client-123", token_use: "access", sub: "cognito-user-1" }),
      guardrailService,
      modelStreamingService: failingStreamingService,
      conversationRepository: repository,
    }))
      .post("/v1/conversations")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "First persisted message", clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf" });

    expect(response).toMatchObject({ status: 502, body: { error: "Streaming request to OpenAI failed." } });
    await expect(
      migrationClient.query("select status, content from messages where role = 'assistant'"),
    ).resolves.toMatchObject({ rows: [{ status: "error", content: "" }] });
  });

  it("rejects invalid input before persistence or model invocation", async () => {
    const response = await request(
      createApp({
        verifyAccessToken: vi.fn().mockResolvedValue({
          client_id: "client-123",
          token_use: "access",
          sub: "cognito-user-1",
        }),
        guardrailService,
        modelStreamingService,
        conversationRepository: repository,
      }),
    )
      .post("/v1/conversations")
      .set("Authorization", "Bearer valid-token")
      .send({
        message: " ",
        clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      });

    expect(response.status).toBe(400);
    expect(guardrailService.evaluate).not.toHaveBeenCalled();
    expect(modelStreamingService.start).not.toHaveBeenCalled();
    await expect(
      migrationClient.query("select count(*)::integer as count from conversations"),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("keeps the guardrail fallback stateless", async () => {
    const interveningGuardrail: GuardrailService = {
      evaluate: vi.fn().mockResolvedValue({
        action: "GUARDRAIL_INTERVENED",
        detectedTopics: [],
        detectedPii: [],
        detectedContentFilters: [],
        latencyMs: 1,
      }),
    };

    const response = await request(
      createApp({
        verifyAccessToken: vi.fn().mockResolvedValue({
          client_id: "client-123",
          token_use: "access",
          sub: "cognito-user-1",
        }),
        guardrailService: interveningGuardrail,
        modelStreamingService,
        conversationRepository: repository,
      }),
    )
      .post("/v1/conversations")
      .set("Authorization", "Bearer valid-token")
      .send({
        message: "unsafe request",
        clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      });

    expect(response.status).toBe(200);
    expect(response.text).toMatch(/^data: \{"delta":".+"\}\n\ndata: \[DONE\]\n\n$/);
    expect(modelStreamingService.start).not.toHaveBeenCalled();
    await expect(
      migrationClient.query("select count(*)::integer as count from conversations"),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("limits normalized messages to 10,000 characters before persistence", async () => {
    const response = await request(
      createApp({
        verifyAccessToken: vi.fn().mockResolvedValue({
          client_id: "client-123",
          token_use: "access",
          sub: "cognito-user-1",
        }),
        guardrailService,
        modelStreamingService,
        conversationRepository: repository,
      }),
    )
      .post("/v1/conversations")
      .set("Authorization", "Bearer valid-token")
      .send({
        message: "a".repeat(10_001),
        clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      });

    expect(response.status).toBe(400);
    expect(guardrailService.evaluate).not.toHaveBeenCalled();
    expect(modelStreamingService.start).not.toHaveBeenCalled();
    await expect(
      migrationClient.query("select count(*)::integer as count from conversations"),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("resolves an existing User without creating a second local record", async () => {
    const app = createApp({
      verifyAccessToken: vi.fn().mockResolvedValue({
        client_id: "client-123",
        token_use: "access",
        sub: "cognito-user-1",
      }),
      guardrailService,
      modelStreamingService,
      conversationRepository: repository,
    });

    for (const [message, clientMessageId] of [
      ["first message", "4f9a19a2-e950-4ea2-95a7-63d5910b7edf"],
      ["second message", "06d0d6f4-8e86-44a2-9c57-64062be285a0"],
    ]) {
      const response = await request(app)
        .post("/v1/conversations")
        .set("Authorization", "Bearer valid-token")
        .send({ message, clientMessageId });
      expect(response.status).toBe(200);
    }

    await expect(
      migrationClient.query(
        "select (select count(*)::integer from users) as users, (select count(*)::integer from conversations) as conversations",
      ),
    ).resolves.toMatchObject({ rows: [{ users: 1, conversations: 2 }] });
  });
});
