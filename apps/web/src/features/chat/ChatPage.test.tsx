import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage";
import {
  ConversationNotFoundError,
  getConversation,
  listConversationMessages,
  listConversations,
  streamConversationResponse,
} from "./chatApi";

vi.mock("./chatApi", async () => {
  const actual = await vi.importActual<typeof import("./chatApi")>("./chatApi");
  return {
    ...actual,
    getConversation: vi.fn(),
    listConversations: vi.fn(),
    listConversationMessages: vi.fn(),
    streamConversationResponse: vi.fn(),
  };
});

const listConversationsMock = vi.mocked(listConversations);
const listConversationMessagesMock = vi.mocked(listConversationMessages);
const getConversationMock = vi.mocked(getConversation);
const streamConversationResponseMock = vi.mocked(streamConversationResponse);

const conversation = (id: string, title = `Conversation ${id}`) => ({
  id,
  title,
  createdAt: `2026-01-${id.padStart(2, "0")}T00:00:00.000Z`,
  activityAt: `2026-01-${id.padStart(2, "0")}T00:00:00.000Z`,
});

const message = (id: string, content: string) => ({
  id,
  role: "user" as const,
  status: "complete" as const,
  content,
  metadata: {},
  replyToMessageId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  getConversationMock.mockImplementation(async (id) => conversation(id));
  listConversationMessagesMock.mockImplementation(async (id) => ({ messages: [message(id, `${id} history`)] }));
});

describe("ChatPage conversation loading", () => {
  it("keeps the New chat state on / while listing saved Conversations", async () => {
    listConversationsMock.mockResolvedValue({
      conversations: [conversation("2", "Newest"), conversation("1", "Older")],
    });

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Newest" })).not.toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
    expect(listConversationMessagesMock).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent("access-token-value");
  });

  it("loads a deep-linked Conversation and adds one outside the first sidebar page", async () => {
    window.history.replaceState({}, "", "/conversations/42");
    listConversationsMock.mockResolvedValue({ conversations: [conversation("2", "Newest")] });
    getConversationMock.mockResolvedValue(conversation("42", "Deep link"));
    listConversationMessagesMock.mockResolvedValue({ messages: [message("message-42", "Deep history")] });

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);

    expect(await screen.findByText("Deep history")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deep link" })).toHaveAttribute("aria-current", "page");
    expect(getConversationMock).toHaveBeenCalledWith("42", "access-token-value");
    expect(listConversationMessagesMock).toHaveBeenCalledWith("42", "access-token-value");
  });

  it("switches Conversations, starts New chat, and keeps the URL in sync", async () => {
    listConversationsMock.mockResolvedValue({ conversations: [conversation("2", "Newest"), conversation("1", "Older")] });

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);
    await screen.findByRole("button", { name: "Older" });

    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(window.location.pathname).toBe("/conversations/1");
    expect(await screen.findByText("1 history")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(window.location.pathname).toBe("/");
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
  });

  it("adopts the first persisted Conversation URL without adding a history entry", async () => {
    listConversationsMock.mockResolvedValue({ conversations: [] });
    streamConversationResponseMock.mockImplementation(async ({ onTurnStarted, onTerminal }) => {
      onTurnStarted({ conversationId: "7", userMessageId: "8", assistantMessageId: "9" });
      onTerminal("complete");
    });

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);
    await screen.findByText("No saved conversations.");
    const historyLength = window.history.length;
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(window.location.pathname).toBe("/conversations/7"));
    expect(window.history.length).toBe(historyLength);
  });

  it("restores Conversation state from browser history", async () => {
    listConversationsMock.mockResolvedValue({ conversations: [conversation("1", "One"), conversation("2", "Two")] });
    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);
    await screen.findByRole("button", { name: "One" });

    fireEvent.click(screen.getByRole("button", { name: "One" }));
    await screen.findByText("1 history");
    fireEvent.click(screen.getByRole("button", { name: "Two" }));
    await screen.findByText("2 history");
    window.history.back();

    await waitFor(() => expect(window.location.pathname).toBe("/conversations/1"));
    expect(await screen.findByText("1 history")).toBeInTheDocument();
  });

  it("shows a safe not-found state for malformed and inaccessible routes", async () => {
    window.history.replaceState({}, "", "/conversations/not-an-id");
    listConversationsMock.mockResolvedValue({ conversations: [conversation("1")] });
    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);
    expect(await screen.findByText("Conversation not found")).toBeInTheDocument();
    expect(listConversationMessagesMock).not.toHaveBeenCalled();

    getConversationMock.mockRejectedValueOnce(new ConversationNotFoundError());
    window.history.replaceState({}, "", "/conversations/99");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(await screen.findByText("Conversation not found")).toBeInTheDocument();
  });

  it("does not let an older route load overwrite the newer selection", async () => {
    const firstDetails = deferred<ReturnType<typeof conversation>>();
    const secondDetails = deferred<ReturnType<typeof conversation>>();
    listConversationsMock.mockResolvedValue({ conversations: [conversation("1", "One"), conversation("2", "Two")] });
    getConversationMock.mockImplementation((id) => id === "1" ? firstDetails.promise : secondDetails.promise);

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);
    await screen.findByRole("button", { name: "One" });
    fireEvent.click(screen.getByRole("button", { name: "One" }));
    fireEvent.click(screen.getByRole("button", { name: "Two" }));
    secondDetails.resolve(conversation("2", "Two"));
    await screen.findByText("2 history");
    firstDetails.resolve(conversation("1", "One"));

    await waitFor(() => expect(screen.queryByText("1 history")).not.toBeInTheDocument());
    expect(screen.getByText("2 history")).toBeInTheDocument();
  });

  it("aborts streaming before browser navigation can display the old Conversation", async () => {
    listConversationsMock.mockResolvedValue({ conversations: [conversation("2", "Two")] });
    streamConversationResponseMock.mockImplementation(async ({ onDelta, signal }) => {
      onDelta("old partial");
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);
    await screen.findByRole("button", { name: "Two" });
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("old partial")).toBeInTheDocument();

    window.history.pushState({}, "", "/conversations/2");
    fireEvent(window, new PopStateEvent("popstate"));

    expect(await screen.findByText("2 history")).toBeInTheDocument();
    expect(screen.queryByText("old partial")).not.toBeInTheDocument();
  });

  it("keeps the New chat empty state for an account with no Conversations", async () => {
    listConversationsMock.mockResolvedValue({ conversations: [] });

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);

    expect(await screen.findByText("No saved conversations.")).toBeInTheDocument();
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
  });

  it("merges older Conversation and Message pages without changing the selection", async () => {
    listConversationsMock.mockImplementation(async (_token, cursor) => cursor
      ? { conversations: [{ id: "1", title: "Older", createdAt: "2026-01-01T00:00:00.000Z", activityAt: "2026-01-01T00:00:00.000Z" }] }
      : {
          conversations: [{ id: "2", title: "Newest", createdAt: "2026-01-02T00:00:00.000Z", activityAt: "2026-01-02T00:00:00.000Z" }],
          nextCursor: "older-conversations",
        });
    listConversationMessagesMock.mockImplementation(async (id, _token, cursor) => cursor
      ? { messages: [{ id: "1", role: "user", status: "complete", content: "Older message", metadata: {}, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z" }] }
      : {
          messages: [{ id, role: "assistant", status: "complete", content: "Newest message", metadata: {}, replyToMessageId: null, createdAt: "2026-01-02T00:00:00.000Z" }],
          nextCursor: "older-messages",
        });

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);

    await screen.findByRole("button", { name: "Newest" });
    fireEvent.click(screen.getByRole("button", { name: "Newest" }));
    expect(await screen.findByText("Newest message")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(await screen.findByText("Older message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conversation 2" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Load more conversations" }));
    expect(await screen.findByRole("button", { name: "Older" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conversation 2" })).toHaveAttribute("aria-current", "page");
  });

  it("retains partial output and labels it aborted after Stop", async () => {
    listConversationsMock.mockResolvedValue({ conversations: [] });
    streamConversationResponseMock.mockImplementation(async ({ onDelta, signal }) => {
      onDelta("Partial answer");
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        }, { once: true });
      });
    });

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);

    await screen.findByText("No saved conversations.");
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Partial answer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(await screen.findByText("aborted")).toBeInTheDocument();
    expect(screen.getByText("Partial answer")).toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
