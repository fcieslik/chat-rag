import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage";
import { listConversationMessages, listConversations, streamConversationResponse } from "./chatApi";

vi.mock("./chatApi", async () => {
  const actual = await vi.importActual<typeof import("./chatApi")>("./chatApi");
  return {
    ...actual,
    listConversations: vi.fn(),
    listConversationMessages: vi.fn(),
    streamConversationResponse: vi.fn(),
  };
});

const listConversationsMock = vi.mocked(listConversations);
const listConversationMessagesMock = vi.mocked(listConversationMessages);
const streamConversationResponseMock = vi.mocked(streamConversationResponse);

describe("ChatPage conversation loading", () => {
  it("opens the newest Conversation and replaces its history when another is selected", async () => {
    listConversationsMock.mockResolvedValue({
      conversations: [
        { id: "2", title: "Newest", createdAt: "2026-01-02T00:00:00.000Z", activityAt: "2026-01-02T00:00:00.000Z" },
        { id: "1", title: "Older", createdAt: "2026-01-01T00:00:00.000Z", activityAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    listConversationMessagesMock.mockImplementation(async (id) => ({ messages: [{
      id, role: "user", status: "complete", content: id === "2" ? "Newest history" : "Older history", metadata: {}, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z",
    }] }));

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);

    expect(await screen.findByText("Newest history")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(await screen.findByText("Older history")).toBeInTheDocument();
    expect(screen.queryByText("Newest history")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("access-token-value");
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

    expect(await screen.findByText("Newest message")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
    expect(await screen.findByText("Older message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Load more conversations" }));
    expect(await screen.findByRole("button", { name: "Older" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-current", "page");
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
