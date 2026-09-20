import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatPage } from "./ChatPage";
import { listConversationMessages, listConversations } from "./chatApi";

vi.mock("./chatApi", async () => {
  const actual = await vi.importActual<typeof import("./chatApi")>("./chatApi");
  return { ...actual, listConversations: vi.fn(), listConversationMessages: vi.fn() };
});

const listConversationsMock = vi.mocked(listConversations);
const listConversationMessagesMock = vi.mocked(listConversationMessages);

describe("ChatPage conversation loading", () => {
  it("opens the newest Conversation and replaces its history when another is selected", async () => {
    listConversationsMock.mockResolvedValue([
      { id: "2", title: "Newest", createdAt: "2026-01-02T00:00:00.000Z", activityAt: "2026-01-02T00:00:00.000Z" },
      { id: "1", title: "Older", createdAt: "2026-01-01T00:00:00.000Z", activityAt: "2026-01-01T00:00:00.000Z" },
    ]);
    listConversationMessagesMock.mockImplementation(async (id) => [{
      id, role: "user", status: "complete", content: id === "2" ? "Newest history" : "Older history", metadata: {}, replyToMessageId: null, createdAt: "2026-01-01T00:00:00.000Z",
    }]);

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);

    expect(await screen.findByText("Newest history")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Newest" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(await screen.findByText("Older history")).toBeInTheDocument();
    expect(screen.queryByText("Newest history")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("access-token-value");
  });

  it("keeps the New chat empty state for an account with no Conversations", async () => {
    listConversationsMock.mockResolvedValue([]);

    render(<ChatPage accessToken="access-token-value" onAuthenticationFailure={vi.fn()} onSignOut={vi.fn()} />);

    expect(await screen.findByText("No saved conversations.")).toBeInTheDocument();
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
  });
});
