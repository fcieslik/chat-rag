import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  listConversationMessages,
  listConversations,
  streamConversationResponse,
} from "./chatApi";

describe("chat API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the Cognito access token as a bearer credential", async () => {
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: turn.started\ndata: {"conversationId":"42","userMessageId":"43","assistantMessageId":"44"}\n\nevent: response.delta\ndata: {"delta":"hello"}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(responseBody, { status: 200 }),
    );
    const deltas: string[] = [];
    const turns: string[] = [];

    await streamConversationResponse({
      conversationId: "42",
      message: "question",
      clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      accessToken: "access-token-value",
      onTurnStarted: (turn) => turns.push(turn.conversationId),
      onDelta: (delta) => deltas.push(delta),
      onTerminal: () => undefined,
      signal: new AbortController().signal,
    });

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
    expect(turns).toEqual(["42"]);
  });

  it("reports a failed streaming terminal event after retaining received deltas", async () => {
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: response.delta\ndata: {"delta":"partial"}\n\nevent: response.failed\ndata: {"error":"Streaming failed."}\n\n'));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(responseBody, { status: 200 }));
    const deltas: string[] = [];
    const terminalStates: string[] = [];

    await streamConversationResponse({
      conversationId: "42",
      message: "question",
      clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf",
      accessToken: "access-token-value",
      onTurnStarted: () => undefined,
      onDelta: (delta) => deltas.push(delta),
      onTerminal: (status) => terminalStates.push(status),
      signal: new AbortController().signal,
    });

    expect(deltas).toEqual(["partial"]);
    expect(terminalStates).toEqual(["error"]);
  });

  it("rejects a chat request when no access token is available", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      streamConversationResponse({
        conversationId: null,
        message: "question",
        clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf",
        accessToken: "",
        onTurnStarted: () => undefined,
        onDelta: () => undefined,
        onTerminal: () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Authentication is required.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("identifies an expired API session as an authentication failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      streamConversationResponse({
        conversationId: null,
        message: "question",
        clientMessageId: "4f9a19a2-e950-4ea2-95a7-63d5910b7edf",
        accessToken: "expired-token",
        onTurnStarted: () => undefined,
        onDelta: () => undefined,
        onTerminal: () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("passes opaque cursors through the Conversation and Message endpoints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ conversations: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { status: 200 }));

    await listConversations("access-token-value", "conversation cursor");
    await listConversationMessages("42", "access-token-value", "message cursor");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("cursor=conversation+cursor"),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/42/messages?cursor=message+cursor"),
      expect.anything(),
    );
  });
});
