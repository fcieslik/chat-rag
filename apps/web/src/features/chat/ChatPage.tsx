import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AuthenticationError,
  type AssistantTerminalStatus,
  type Conversation,
  type ConversationMessage,
  listConversationMessages,
  listConversations,
  streamConversationResponse,
} from "./chatApi";

type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string | number;
  role: Role;
  content: string;
  status?: ConversationMessage["status"];
}

interface ChatPageProps {
  accessToken: string;
  onAuthenticationFailure: () => void;
  onSignOut: () => void;
}

export function ChatPage({ accessToken, onAuthenticationFailure, onSignOut }: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const nextMessageId = useRef(0);

  useEffect(() => {
    let active = true;

    async function loadNewestConversation() {
      try {
        const loadedConversations = await listConversations(accessToken);
        if (!active) return;
        setConversations(loadedConversations);
        const newestConversation = loadedConversations[0];
        if (newestConversation) {
          await selectConversation(newestConversation.id, active);
        }
      } catch (requestError) {
        if (active) handleLoadError(requestError);
      } finally {
        if (active) setIsLoadingConversations(false);
      }
    }

    void loadNewestConversation();
    return () => { active = false; };
  }, [accessToken]);

  function handleLoadError(requestError: unknown) {
    if (requestError instanceof AuthenticationError) onAuthenticationFailure();
    setError(requestError instanceof Error ? requestError.message : "The conversation could not be loaded.");
  }

  async function selectConversation(conversationId: string, active = true) {
    try {
      const loadedMessages = await listConversationMessages(conversationId, accessToken);
      if (!active) return;
      setSelectedConversationId(conversationId);
      setMessages(loadedMessages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
      })));
      setError(null);
    } catch (requestError) {
      if (active) handleLoadError(requestError);
    }
  }

  function startNewChat() {
    if (isStreaming) return;
    setSelectedConversationId(null);
    setMessages([]);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();

    if (!message || isStreaming) {
      return;
    }

    const userMessage: ChatMessage = {
      id: nextMessageId.current++,
      role: "user",
      content: message,
    };
    const assistantMessageId = nextMessageId.current++;
    const conversationId = selectedConversationId;
    const activityAt = new Date().toISOString();

    setInput("");
    setError(null);
    setIsStreaming(true);
    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      { id: assistantMessageId, role: "assistant", content: "" },
    ]);
    if (conversationId) {
      setConversations((currentConversations) => {
        const activeConversation = currentConversations.find(
          (conversation) => conversation.id === conversationId,
        );
        if (!activeConversation) return currentConversations;
        return [
          { ...activeConversation, activityAt },
          ...currentConversations.filter((conversation) => conversation.id !== conversationId),
        ];
      });
    }

    const controller = new AbortController();
    abortController.current = controller;

    try {
      await streamConversationResponse({
        conversationId,
        message,
        clientMessageId: crypto.randomUUID(),
        accessToken,
        onTurnStarted: (turn) => {
          if (!conversationId) {
            setSelectedConversationId(turn.conversationId);
            setConversations((currentConversations) => [
              {
                id: turn.conversationId,
                title: message.slice(0, 80),
                createdAt: activityAt,
                activityAt,
              },
              ...currentConversations,
            ]);
          }
        },
        onDelta: (delta) => {
          setMessages((currentMessages) =>
            currentMessages.map((currentMessage) =>
              currentMessage.id === assistantMessageId
                ? { ...currentMessage, content: currentMessage.content + delta }
                : currentMessage,
            ),
          );
        },
        onTerminal: (status) => {
          setAssistantMessageStatus(assistantMessageId, status);
        },
        signal: controller.signal,
      });
    } catch (requestError) {
      if (controller.signal.aborted) {
        setAssistantMessageStatus(assistantMessageId, "aborted");
      } else {
        if (requestError instanceof Error && requestError.name === "AuthenticationError") {
          onAuthenticationFailure();
        }
        setError(requestError instanceof Error ? requestError.message : "The chat request failed.");
        setAssistantMessageStatus(assistantMessageId, "error");
      }
    } finally {
      if (abortController.current === controller) {
        abortController.current = null;
      }
      setIsStreaming(false);
    }
  }

  function handleStop() {
    abortController.current?.abort();
  }

  function setAssistantMessageStatus(
    assistantMessageId: string | number,
    status: AssistantTerminalStatus,
  ) {
    setMessages((currentMessages) =>
      currentMessages.map((currentMessage) =>
        currentMessage.id === assistantMessageId
          ? { ...currentMessage, status }
          : currentMessage,
      ),
    );
  }

  return (
    <main className="chat-shell">
      <section className="chat-card" aria-label="AI chat">
        <aside className="conversation-sidebar" aria-label="Conversations">
          <button type="button" onClick={startNewChat} disabled={isStreaming}>New chat</button>
          {isLoadingConversations ? (
            <p role="status">Loading conversations…</p>
          ) : conversations.length === 0 ? (
            <p>No saved conversations.</p>
          ) : (
            <ul>
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    className={conversation.id === selectedConversationId ? "conversation-selected" : ""}
                    aria-current={conversation.id === selectedConversationId ? "page" : undefined}
                    disabled={isStreaming}
                    onClick={() => void selectConversation(conversation.id)}
                  >
                    {conversation.title || "Untitled conversation"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="chat-content">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Chat RAG</p>
            <h1>AI Chat</h1>
          </div>
          <span className={isStreaming ? "status status-streaming" : "status"}>
            {isStreaming ? "Streaming" : "Ready"}
          </span>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </header>

        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">✦</span>
              <h2>Start a conversation</h2>
              <p>Ask anything and watch the answer arrive in real time.</p>
            </div>
          ) : (
            messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                <span className="message-role">{message.role === "user" ? "You" : "AI"}</span>
                <p>{message.content || (isStreaming && message.role === "assistant" ? "…" : "")}</p>
                {message.status && message.status !== "complete" && (
                  <span className="message-status">{message.status}</span>
                )}
              </article>
            ))
          )}
        </div>

        {error && <p className="error-message" role="alert">{error}</p>}

        <form className="composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="message">Message</label>
          <textarea
            id="message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask something..."
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button className="stop-button" type="button" onClick={handleStop}>Stop</button>
          ) : (
            <button type="submit" disabled={!input.trim()}>Send</button>
          )}
        </form>
        <p className="composer-hint">Press Enter to send · Shift + Enter for a new line</p>
        </section>
      </section>
    </main>
  );
}
