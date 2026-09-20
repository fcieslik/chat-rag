import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { GuardrailService } from "./guardrailService.js";
import type { ModelStreamingService } from "./modelStreaming.js";

const validClaims = {
  client_id: "client-123",
  token_use: "access" as const,
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
});
