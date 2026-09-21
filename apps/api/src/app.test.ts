import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { ConversationRepository } from "./db/conversationRepository.js";
import type { GuardrailService } from "./guardrailService.js";
import type { ModelStreamingService } from "./modelStreaming.js";

const validClaims = {
  client_id: "client-123",
  token_use: "access" as const,
  sub: "cognito-user-1",
};

function createGuardrailService(
  action: "NONE" | "GUARDRAIL_INTERVENED",
): GuardrailService {
  return {
    evaluate: vi.fn().mockResolvedValue({
      action,
      detectedTopics: [],
      detectedPii: [],
      detectedContentFilters: [],
      latencyMs: 1,
    }),
  };
}

function createModelStreamingService(
  ...deltas: string[]
): ModelStreamingService {
  return {
    start: vi.fn().mockResolvedValue(
      (async function* () {
        yield* deltas;
      })(),
    ),
  };
}

function createConversationRepository(): ConversationRepository {
  return {
    findTurnByClientMessageId: vi.fn().mockResolvedValue({ kind: "missing" }),
    createFirstTurn: vi.fn().mockResolvedValue({
      kind: "created",
      turn: {
        conversationId: 1n,
        userMessageId: 2n,
        assistantMessageId: 3n,
      },
    }),
    appendTurn: vi.fn(),
    finishAssistantMessage: vi.fn().mockResolvedValue(undefined),
    listOwnedConversations: vi.fn(),
    getOwnedConversation: vi.fn(),
    listOwnedMessages: vi.fn(),
    ready: vi.fn(),
    close: vi.fn(),
  };
}

describe("API authentication boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  });

  it.each([
    ["without credentials", undefined, false],
    ["with a malformed bearer value", "Basic credentials", false],
    ["with an invalid token", "Bearer invalid-token", true],
  ])("returns 401 for a request %s", async (_name, authorization, verifies) => {
    const verifyAccessToken = vi.fn().mockRejectedValue(new Error("invalid token"));
    const response = await request(createApp({ verifyAccessToken }))
      .post("/v1/chat")
      .set("Content-Type", "application/json")
      .set(authorization ? "Authorization" : "X-Test", authorization ?? "missing")
      .send({ message: "hello" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
    expect(verifyAccessToken).toHaveBeenCalledTimes(verifies ? 1 : 0);
  });

  it("does not call the chat handler for a rejected token", async () => {
    const verifyAccessToken = vi.fn().mockRejectedValue(new Error("expired token"));
    const modelStreamingService = createModelStreamingService();

    const response = await request(
      createApp({ verifyAccessToken, modelStreamingService }),
    )
      .post("/v1/chat")
      .set("Authorization", "Bearer expired-token")
      .send({ message: "hello" });

    expect(response.status).toBe(401);
    expect(verifyAccessToken).toHaveBeenCalledWith("expired-token");
    expect(modelStreamingService.start).not.toHaveBeenCalled();
  });

  it("rejects a verified access token without a Cognito subject", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue({
      client_id: "client-123",
      token_use: "access" as const,
    });
    const modelStreamingService = createModelStreamingService();

    const response = await request(
      createApp({ verifyAccessToken, modelStreamingService }),
    )
      .post("/v1/chat")
      .set("Authorization", "Bearer token-without-subject")
      .send({ message: "hello" });

    expect(response.status).toBe(401);
    expect(modelStreamingService.start).not.toHaveBeenCalled();
  });

  it("allows a valid token to reach the streaming chat handler", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(validClaims);
    const guardrailService = createGuardrailService("NONE");
    const modelStreamingService = createModelStreamingService("hel", "lo");

    const response = await request(
      createApp({
        verifyAccessToken,
        guardrailService,
        modelStreamingService,
      }),
    )
      .post("/v1/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "hello" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toBe(
      'data: {"delta":"hel"}\n\ndata: {"delta":"lo"}\n\ndata: [DONE]\n\n',
    );
    expect(guardrailService.evaluate).toHaveBeenCalledWith("hello");
    expect(modelStreamingService.start).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "hello" }],
      signal: expect.any(AbortSignal),
    });
  });

  it("returns the existing failure response when model streaming cannot start", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(validClaims);
    const guardrailService = createGuardrailService("NONE");
    const modelStreamingService: ModelStreamingService = {
      start: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };

    const response = await request(
      createApp({
        verifyAccessToken,
        guardrailService,
        modelStreamingService,
      }),
    )
      .post("/v1/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "hello" });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: "Streaming request to OpenAI failed.",
    });
  });

  it("persists partial output as an error and emits a failed terminal event", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(validClaims);
    const guardrailService = createGuardrailService("NONE");
    const conversationRepository = createConversationRepository();
    const modelStreamingService: ModelStreamingService = {
      start: vi.fn().mockResolvedValue({
        async *[Symbol.asyncIterator]() {
          yield "partial";
          throw new Error("provider unavailable");
        },
      }),
    };

    const response = await request(createApp({
      verifyAccessToken,
      guardrailService,
      modelStreamingService,
      conversationRepository,
    }))
      .post("/v1/conversations")
      .set("Authorization", "Bearer valid-token")
      .send({
        message: "hello",
        clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      });

    expect(response.status).toBe(200);
    expect(response.text).toContain('event: response.delta\ndata: {"delta":"partial"}');
    expect(response.text).toContain('event: response.failed\ndata: {"error":"Streaming failed."}');
    expect(conversationRepository.finishAssistantMessage).toHaveBeenCalledWith(3n, "error", "partial");
  });

  it("persists an aborted terminal state when the streaming client disconnects", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(validClaims);
    const guardrailService = createGuardrailService("NONE");
    const conversationRepository = createConversationRepository();
    let notifyStreamStarted: (() => void) | undefined;
    const streamStarted = new Promise<void>((resolve) => { notifyStreamStarted = resolve; });
    const modelStreamingService: ModelStreamingService = {
      start: vi.fn().mockImplementation(({ signal }) => {
        notifyStreamStarted?.();
        return Promise.resolve({
          async *[Symbol.asyncIterator]() {
            yield "partial";
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            throw abortError;
          },
        });
      }),
    };
    const chatRequest = request(createApp({
      verifyAccessToken,
      guardrailService,
      modelStreamingService,
      conversationRepository,
    }))
      .post("/v1/conversations")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "hello", clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf" });

    const settledRequest = chatRequest.then(() => undefined, () => undefined);
    await streamStarted;
    chatRequest.abort();

    await vi.waitFor(() => {
      expect(conversationRepository.finishAssistantMessage).toHaveBeenCalledWith(3n, "aborted", "partial");
    });
    await settledRequest;
  });

  it("cancels model streaming when the client disconnects", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(validClaims);
    const guardrailService = createGuardrailService("NONE");
    let streamSignal: AbortSignal | undefined;
    let notifyStreamStarted: (() => void) | undefined;
    const streamStarted = new Promise<void>((resolve) => {
      notifyStreamStarted = resolve;
    });
    const modelStreamingService: ModelStreamingService = {
      start: vi.fn().mockImplementation(({ signal }) => {
        streamSignal = signal;
        notifyStreamStarted?.();

        return Promise.resolve({
          async *[Symbol.asyncIterator]() {
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
          },
        });
      }),
    };
    const chatRequest = request(
      createApp({
        verifyAccessToken,
        guardrailService,
        modelStreamingService,
      }),
    )
      .post("/v1/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "hello" });
    const chatResult = chatRequest.then(
      () => undefined,
      () => undefined,
    );

    await streamStarted;
    chatRequest.abort();

    await vi.waitFor(() => expect(streamSignal?.aborted).toBe(true));
    await chatResult;
  });

  it("streams a fallback message without calling OpenAI when the guardrail intervenes", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(validClaims);
    const guardrailService = createGuardrailService("GUARDRAIL_INTERVENED");
    const modelStreamingService = createModelStreamingService();

    const response = await request(
      createApp({
        verifyAccessToken,
        guardrailService,
        modelStreamingService,
      }),
    )
      .post("/v1/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "unsafe request" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toMatch(/^data: \{"delta":".+"\}\n\ndata: \[DONE\]\n\n$/);
    expect(modelStreamingService.start).not.toHaveBeenCalled();
  });

  it("fails closed when the guardrail check is unavailable", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(validClaims);
    const guardrailService: GuardrailService = {
      evaluate: vi.fn().mockRejectedValue(new Error("AWS unavailable")),
    };
    const modelStreamingService = createModelStreamingService();

    const response = await request(
      createApp({
        verifyAccessToken,
        guardrailService,
        modelStreamingService,
      }),
    )
      .post("/v1/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "hello" });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Bedrock Guardrail is unavailable." });
    expect(modelStreamingService.start).not.toHaveBeenCalled();
  });

  it("allows the configured origin to preflight Authorization and Content-Type", async () => {
    const response = await request(createApp())
      .options("/v1/chat")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Authorization, Content-Type");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(response.headers["access-control-allow-headers"]).toContain("Authorization");
  });

  it("validates Conversation page parameters and encodes its keyset cursor", async () => {
    const conversationRepository = createConversationRepository();
    vi.mocked(conversationRepository.listOwnedConversations).mockResolvedValue({
      conversations: [{
        id: 2n,
        title: "Newest",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        activityAt: new Date("2026-01-02T00:00:00.000Z"),
      }],
      nextCursor: { timestamp: new Date("2026-01-01T00:00:00.000Z"), id: 1n },
    });
    const app = createApp({
      verifyAccessToken: vi.fn().mockResolvedValue(validClaims),
      conversationRepository,
    });

    const response = await request(app).get("/v1/conversations").set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ conversations: [{ id: "2", title: "Newest" }], nextCursor: expect.any(String) });
    expect(conversationRepository.listOwnedConversations).toHaveBeenCalledWith(
      "cognito-user-1",
      { limit: 20 },
    );
    await request(app)
      .get(`/v1/conversations?cursor=${encodeURIComponent(response.body.nextCursor)}`)
      .set("Authorization", "Bearer token");
    expect(conversationRepository.listOwnedConversations).toHaveBeenLastCalledWith(
      "cognito-user-1",
      { limit: 20, cursor: { timestamp: new Date("2026-01-01T00:00:00.000Z"), id: 1n } },
    );
    await expect(request(app).get("/v1/conversations?limit=101").set("Authorization", "Bearer token"))
      .resolves.toMatchObject({ status: 400, body: { error: "Invalid pagination parameters." } });
    await expect(request(app).get("/v1/conversations?cursor=invalid").set("Authorization", "Bearer token"))
      .resolves.toMatchObject({ status: 400, body: { error: "Invalid pagination parameters." } });
  });

  it("loads the newest Message page chronologically and accepts its opaque older cursor", async () => {
    const conversationRepository = createConversationRepository();
    vi.mocked(conversationRepository.listOwnedMessages).mockResolvedValue({
      messages: [{
        id: 2n,
        role: "assistant",
        status: "complete",
        content: "Newest",
        metadata: {},
        replyToMessageId: null,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      }],
      nextCursor: { timestamp: new Date("2026-01-01T00:00:00.000Z"), id: 1n },
    });
    const app = createApp({
      verifyAccessToken: vi.fn().mockResolvedValue(validClaims),
      conversationRepository,
    });

    const response = await request(app)
      .get("/v1/conversations/42/messages?limit=100")
      .set("Authorization", "Bearer token");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ messages: [{ id: "2", content: "Newest" }], nextCursor: expect.any(String) });
    expect(conversationRepository.listOwnedMessages).toHaveBeenCalledWith(
      "cognito-user-1",
      42n,
      { limit: 100 },
    );
  });
});
