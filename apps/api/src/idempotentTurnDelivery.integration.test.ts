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

describePostgres("idempotent Turn delivery", () => {
  let migrationClient: Client;
  let repository: ReturnType<typeof createConversationRepository>;
  let guardrailService: GuardrailService;
  let modelStreamingService: ModelStreamingService;

  beforeEach(async () => {
    await runMigrations(migrationDatabaseUrl);
    migrationClient = new Client({ connectionString: migrationDatabaseUrl });
    await migrationClient.connect();
    await migrationClient.query("truncate messages, conversations, users restart identity cascade");
    repository = createConversationRepository(applicationDatabaseUrl);
    guardrailService = { evaluate: vi.fn().mockResolvedValue({ action: "NONE", detectedTopics: [], detectedPii: [], detectedContentFilters: [], latencyMs: 1 }) };
    modelStreamingService = { start: vi.fn().mockResolvedValue((async function* () { yield "stored reply"; })()) };
  });

  afterEach(async () => {
    await repository.close();
    await migrationClient.end();
  });

  it("replays a completed first Turn without rerunning external services", async () => {
    const app = createApp({
      verifyAccessToken: async () => ({ client_id: "client", token_use: "access", sub: "owner" }),
      guardrailService,
      modelStreamingService,
      conversationRepository: repository,
    });
    const body = { message: "first message", clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf" };

    const first = await request(app).post("/v1/conversations").set("Authorization", "Bearer token").send(body);
    vi.clearAllMocks();
    const retry = await request(app).post("/v1/conversations").set("Authorization", "Bearer token").send(body);

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.text).toContain('event: response.delta\ndata: {"delta":"stored reply"}');
    expect(guardrailService.evaluate).not.toHaveBeenCalled();
    expect(modelStreamingService.start).not.toHaveBeenCalled();
    await expect(migrationClient.query("select (select count(*)::integer from conversations) as conversations, (select count(*)::integer from messages) as messages"))
      .resolves.toMatchObject({ rows: [{ conversations: 1, messages: 2 }] });
  });

  it.each(["pending", "error", "aborted"] as const)("rejects a %s first Turn retry without external calls", async (status) => {
    const clientMessageId = "4f9a19a2-e950-4ea2-95a7-63d5910b7edf";
    await storeTurn("owner", clientMessageId, status, "partial reply");

    const response = await postFirst("owner", { message: "first message", clientMessageId });

    expect(response).toMatchObject({ status: 409, body: { error: "Turn delivery is not complete." } });
    expect(guardrailService.evaluate).not.toHaveBeenCalled();
    expect(modelStreamingService.start).not.toHaveBeenCalled();
  });

  it("replays a completed later Turn without rerunning external services", async () => {
    const clientMessageId = "5f9a19a2-e950-4ea2-95a7-63d5910b7edf";
    const conversationId = await storeTurn("owner", clientMessageId, "complete", "stored reply");

    const response = await postLater("owner", conversationId, { message: "later message", clientMessageId });

    expect(response.status).toBe(200);
    expect(response.text).toContain('event: response.delta\ndata: {"delta":"stored reply"}');
    expect(guardrailService.evaluate).not.toHaveBeenCalled();
    expect(modelStreamingService.start).not.toHaveBeenCalled();
  });

  it("creates a new later Turn when the client supplies a new UUID", async () => {
    const conversationId = await storeTurn(
      "owner",
      "5f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      "complete",
      "stored reply",
    );

    const response = await postLater("owner", conversationId, {
      message: "regenerated message",
      clientMessageId: "9f9a19a2-e950-4ea2-95a7-63d5910b7edf",
    });

    expect(response.status).toBe(200);
    expect(modelStreamingService.start).toHaveBeenCalledOnce();
    await expect(migrationClient.query("select count(*)::integer as count from messages where conversation_id = $1", [conversationId]))
      .resolves.toMatchObject({ rows: [{ count: 4 }] });
  });

  it("does not disclose a UUID collision belonging to another User", async () => {
    const clientMessageId = "6f9a19a2-e950-4ea2-95a7-63d5910b7edf";
    await storeTurn("owner", clientMessageId, "complete", "owner-only reply");

    const response = await postFirst("other-user", { message: "first message", clientMessageId });

    expect(response).toMatchObject({ status: 409, body: { error: "Turn delivery is not complete." } });
    expect(response.text).not.toContain("owner-only reply");
    expect(guardrailService.evaluate).not.toHaveBeenCalled();
    expect(modelStreamingService.start).not.toHaveBeenCalled();
  });

  it("serializes concurrent first-Conversation delivery with one UUID", async () => {
    const input = {
      cognitoSubject: "owner",
      message: "first message",
      clientMessageId: "7f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      assistantMetadata: { model: "test" },
    };

    const results = await Promise.all([repository.createFirstTurn(input), repository.createFirstTurn(input)]);

    expect(results.map((result) => result.kind).sort()).toEqual(["created", "incomplete"]);
    await expect(migrationClient.query("select (select count(*)::integer from conversations) as conversations, (select count(*)::integer from messages where role = 'user') as users, (select count(*)::integer from messages where role = 'assistant') as assistants"))
      .resolves.toMatchObject({ rows: [{ conversations: 1, users: 1, assistants: 1 }] });
  });

  it("serializes concurrent later delivery with one UUID", async () => {
    const conversationId = await createConversation("owner");
    const input = {
      cognitoSubject: "owner",
      conversationId,
      message: "later message",
      clientMessageId: "8f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      assistantMetadata: { model: "test" },
    };

    const results = await Promise.all([repository.appendTurn(input), repository.appendTurn(input)]);

    expect(results.map((result) => result.kind).sort()).toEqual(["created", "incomplete"]);
    await expect(migrationClient.query("select count(*)::integer as count from messages where conversation_id = $1", [conversationId]))
      .resolves.toMatchObject({ rows: [{ count: 2 }] });
  });

  async function postFirst(subject: string, body: { message: string; clientMessageId: string }) {
    return request(createApp({
      verifyAccessToken: async () => ({ client_id: "client", token_use: "access", sub: subject }),
      guardrailService,
      modelStreamingService,
      conversationRepository: repository,
    })).post("/v1/conversations").set("Authorization", "Bearer token").send(body);
  }

  async function postLater(
    subject: string,
    conversationId: bigint,
    body: { message: string; clientMessageId: string },
  ) {
    return request(createApp({
      verifyAccessToken: async () => ({ client_id: "client", token_use: "access", sub: subject }),
      guardrailService,
      modelStreamingService,
      conversationRepository: repository,
    })).post(`/v1/conversations/${conversationId}/messages`).set("Authorization", "Bearer token").send(body);
  }

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

  async function storeTurn(
    subject: string,
    clientMessageId: string,
    status: "pending" | "complete" | "error" | "aborted",
    content: string,
  ): Promise<bigint> {
    const conversationId = await createConversation(subject);
    const userMessage = await migrationClient.query<{ id: bigint }>(
      "insert into messages (conversation_id, role, status, content, client_message_id) values ($1, 'user', 'complete', 'stored question', $2) returning id",
      [conversationId, clientMessageId],
    );
    await migrationClient.query(
      "insert into messages (conversation_id, role, status, content, reply_to_message_id) values ($1, 'assistant', $2, $3, $4)",
      [conversationId, status, content, userMessage.rows[0]!.id],
    );
    return conversationId;
  }
});
