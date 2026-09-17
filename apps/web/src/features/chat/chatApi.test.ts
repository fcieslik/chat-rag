import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, streamChatResponse } from "./chatApi";

describe("chat API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the Cognito access token as a bearer credential", async () => {
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"delta":"hello"}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(responseBody, { status: 200 }),
    );
    const deltas: string[] = [];

    await streamChatResponse("question", "access-token-value", (delta) => deltas.push(delta), new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer access-token-value",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(deltas).toEqual(["hello"]);
  });

  it("rejects a chat request when no access token is available", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      streamChatResponse("question", "", () => undefined, new AbortController().signal),
    ).rejects.toThrow("Authentication is required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("identifies an expired API session as an authentication failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      streamChatResponse("question", "expired-token", () => undefined, new AbortController().signal),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
