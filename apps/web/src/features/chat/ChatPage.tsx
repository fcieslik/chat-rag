import { FormEvent, useRef, useState } from "react";
import { streamChatResponse } from "./chatApi";

type Role = "user" | "assistant";

interface ChatMessage {
  id: number;
  role: Role;
  content: string;
}

interface ChatPageProps {
  accessToken: string;
  onAuthenticationFailure: () => void;
  onSignOut: () => void;
}

export function ChatPage({ accessToken, onAuthenticationFailure, onSignOut }: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const nextMessageId = useRef(0);

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

    setInput("");
    setError(null);
    setIsStreaming(true);
    setMessages((currentMessages) => [
      ...currentMessages,
      userMessage,
      { id: assistantMessageId, role: "assistant", content: "" },
    ]);

    const controller = new AbortController();
    abortController.current = controller;

    try {
      await streamChatResponse(
        message,
        accessToken,
        (delta) => {
          setMessages((currentMessages) =>
            currentMessages.map((currentMessage) =>
              currentMessage.id === assistantMessageId
                ? { ...currentMessage, content: currentMessage.content + delta }
                : currentMessage,
            ),
          );
        },
        controller.signal,
      );
    } catch (requestError) {
      if (!controller.signal.aborted) {
        if (requestError instanceof Error && requestError.name === "AuthenticationError") {
          onAuthenticationFailure();
        }
        setError(requestError instanceof Error ? requestError.message : "The chat request failed.");
        setMessages((currentMessages) =>
          currentMessages.filter((currentMessage) => currentMessage.id !== assistantMessageId),
        );
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
    setIsStreaming(false);
  }

  return (
    <main className="chat-shell">
      <section className="chat-card" aria-label="AI chat">
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
    </main>
  );
}
