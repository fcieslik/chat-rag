import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

const validClaims = {
  client_id: "client-123",
  token_use: "access" as const,
};

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
    const openAiFetch = vi.spyOn(globalThis, "fetch");

    const response = await request(createApp({ verifyAccessToken }))
      .post("/v1/chat")
      .set("Authorization", "Bearer expired-token")
      .send({ message: "hello" });

    expect(response.status).toBe(401);
    expect(verifyAccessToken).toHaveBeenCalledWith("expired-token");
    expect(openAiFetch).not.toHaveBeenCalled();
  });

  it("allows a valid token to reach the streaming chat handler", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(validClaims);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',
      { status: 200 },
    ));

    const response = await request(createApp({ verifyAccessToken }))
      .post("/v1/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "hello" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain('data: {"delta":"hello"}');
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
