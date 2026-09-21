import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AuthenticationError,
  ConversationNotFoundError,
  type AssistantTerminalStatus,
  type Conversation,
  type ConversationMessage,
  getConversation,
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

type Route =
  | { kind: "new"; path: "/" }
  | { kind: "conversation"; id: string; path: string }
  | { kind: "not-found"; path: string };

interface StreamSession {
  controller: AbortController;
  initialPath: string;
  adoptedConversationId?: string;
}

export function ChatPage({ accessToken, onAuthenticationFailure, onSignOut }: ChatPageProps) {
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [nextConversationCursor, setNextConversationCursor] = useState<string>();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [nextMessageCursor, setNextMessageCursor] = useState<string>();
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const routeRef = useRef(route);
  const routeLoadVersion = useRef(0);
  const adoptedConversationId = useRef<string | null>(null);
  const streamSession = useRef<StreamSession | null>(null);
  const isStreamingRef = useRef(false);
  const nextMessageId = useRef(0);

  isStreamingRef.current = isStreaming;

  useEffect(() => {
    let active = true;

    async function loadConversations() {
      try {
        const loadedPage = await listConversations(accessToken);
        if (!active) return;
        setConversations((currentConversations) => mergeById(
          loadedPage.conversations,
          currentConversations,
        ));
        setNextConversationCursor(loadedPage.nextCursor);
      } catch (requestError) {
        if (active) handleLoadError(requestError);
      } finally {
        if (active) setIsLoadingConversations(false);
      }
    }

    void loadConversations();
    return () => { active = false; };
  }, [accessToken]);

  useEffect(() => {
    function handlePopState() {
      applyRoute(readRoute(), "history");
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const requestedRoute = route;
    const loadVersion = routeLoadVersion.current + 1;
    routeLoadVersion.current = loadVersion;

    if (
      requestedRoute.kind === "conversation" &&
      adoptedConversationId.current === requestedRoute.id
    ) {
      adoptedConversationId.current = null;
      setIsNotFound(false);
      setIsLoadingConversation(false);
      return;
    }

    selectedConversationIdRef.current = null;
    setSelectedConversationId(null);
    setMessages([]);
    setNextMessageCursor(undefined);
    setError(null);
    setIsNotFound(requestedRoute.kind === "not-found");

    if (requestedRoute.kind !== "conversation") {
      setIsLoadingConversation(false);
      return;
    }

    const conversationId = requestedRoute.id;
    setIsLoadingConversation(true);

    async function loadConversation() {
      try {
        const [conversation, loadedPage] = await Promise.all([
          getConversation(conversationId, accessToken),
          listConversationMessages(conversationId, accessToken),
        ]);
        if (!isCurrentRoute(requestedRoute.path, loadVersion)) return;

        setConversations((currentConversations) => mergeById(
          [conversation],
          currentConversations,
        ));
        selectedConversationIdRef.current = conversationId;
        setSelectedConversationId(conversationId);
        setMessages(loadedPage.messages.map(toChatMessage));
        setNextMessageCursor(loadedPage.nextCursor);
      } catch (requestError) {
        if (!isCurrentRoute(requestedRoute.path, loadVersion)) return;
        if (requestError instanceof ConversationNotFoundError) {
          setIsNotFound(true);
          setError(null);
        } else {
          handleLoadError(requestError);
        }
      } finally {
        if (isCurrentRoute(requestedRoute.path, loadVersion)) {
          setIsLoadingConversation(false);
        }
      }
    }

    void loadConversation();
  }, [accessToken, route]);

  function handleLoadError(requestError: unknown) {
    if (requestError instanceof AuthenticationError) onAuthenticationFailure();
    setError(requestError instanceof Error ? requestError.message : "The conversation could not be loaded.");
  }

  function isCurrentRoute(path: string, loadVersion: number): boolean {
    return routeLoadVersion.current === loadVersion && routeRef.current.path === path;
  }

  function applyRoute(nextRoute: Route, historyMode: "push" | "replace" | "history", preserveView = false) {
    if (nextRoute.path === routeRef.current.path) return;

    if (isStreamingRef.current && !preserveView) {
      abortController.current?.abort();
    }
    if (historyMode === "push") {
      window.history.pushState({}, "", nextRoute.path);
    } else if (historyMode === "replace") {
      window.history.replaceState({}, "", nextRoute.path);
    }

    routeRef.current = nextRoute;
    if (!preserveView) {
      adoptedConversationId.current = null;
    }
    setRoute(nextRoute);
  }

  function selectConversation(conversationId: string) {
    if (isStreaming) return;
    applyRoute(conversationRoute(conversationId), "push");
  }

  function startNewChat() {
    if (isStreaming) return;
    applyRoute({ kind: "new", path: "/" }, "push");
  }

  async function loadMoreConversations() {
    if (!nextConversationCursor || isStreaming || isLoadingMoreConversations) return;
    setIsLoadingMoreConversations(true);
    try {
      const loadedPage = await listConversations(accessToken, nextConversationCursor);
      setConversations((currentConversations) => mergeById(
        currentConversations,
        loadedPage.conversations,
      ));
      setNextConversationCursor(loadedPage.nextCursor);
      setError(null);
    } catch (requestError) {
      handleLoadError(requestError);
    } finally {
      setIsLoadingMoreConversations(false);
    }
  }

  async function loadOlderMessages() {
    const cursor = nextMessageCursor;
    const conversationId = selectedConversationId;
    if (!cursor || !conversationId || isStreaming || isLoadingOlderMessages) return;
    setIsLoadingOlderMessages(true);
    try {
      const loadedPage = await listConversationMessages(conversationId, accessToken, cursor);
      if (selectedConversationIdRef.current !== conversationId) return;
      setMessages((currentMessages) => mergeById(
        loadedPage.messages.map(toChatMessage),
        currentMessages,
      ));
      setNextMessageCursor(loadedPage.nextCursor);
      setError(null);
    } catch (requestError) {
      handleLoadError(requestError);
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();

    if (!message || isStreaming || isNotFound) {
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
    const controller = new AbortController();
    const session: StreamSession = {
      controller,
      initialPath: routeRef.current.path,
    };

    setInput("");
    setError(null);
    setIsStreaming(true);
    streamSession.current = session;
    abortController.current = controller;
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

    try {
      await streamConversationResponse({
        conversationId,
        message,
        clientMessageId: crypto.randomUUID(),
        accessToken,
        onTurnStarted: (turn) => {
          if (!canUpdateStream(session) || conversationId) return;
          session.adoptedConversationId = turn.conversationId;
          adoptedConversationId.current = turn.conversationId;
          selectedConversationIdRef.current = turn.conversationId;
          setSelectedConversationId(turn.conversationId);
          setConversations((currentConversations) => mergeById(
            [{
              id: turn.conversationId,
              title: message.slice(0, 80),
              createdAt: activityAt,
              activityAt,
            }],
            currentConversations,
          ));
          applyRoute(conversationRoute(turn.conversationId), "replace", true);
        },
        onDelta: (delta) => {
          if (!canUpdateStream(session)) return;
          setMessages((currentMessages) =>
            currentMessages.map((currentMessage) =>
              currentMessage.id === assistantMessageId
                ? { ...currentMessage, content: currentMessage.content + delta }
                : currentMessage,
            ),
          );
        },
        onTerminal: (status) => {
          if (canUpdateStream(session)) {
            setAssistantMessageStatus(assistantMessageId, status);
          }
        },
        signal: controller.signal,
      });
    } catch (requestError) {
      if (!canUpdateStream(session)) return;
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
      if (streamSession.current === session) {
        if (controller.signal.aborted && canUpdateStream(session)) {
          setAssistantMessageStatus(assistantMessageId, "aborted");
        }
        streamSession.current = null;
        abortController.current = null;
        setIsStreaming(false);
      }
    }
  }

  function canUpdateStream(session: StreamSession): boolean {
    if (streamSession.current !== session) return false;
    if (routeRef.current.path === session.initialPath) return true;
    return session.adoptedConversationId === routeRef.current.path.slice("/conversations/".length);
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
            <>
              <ul>
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className={conversation.id === selectedConversationId ? "conversation-selected" : ""}
                      aria-current={conversation.id === selectedConversationId ? "page" : undefined}
                      disabled={isStreaming}
                      onClick={() => selectConversation(conversation.id)}
                    >
                      {conversation.title || "Untitled conversation"}
                    </button>
                  </li>
                ))}
              </ul>
              {nextConversationCursor && (
                <button type="button" disabled={isStreaming || isLoadingMoreConversations} onClick={() => void loadMoreConversations()}>
                  {isLoadingMoreConversations ? "Loading conversations…" : "Load more conversations"}
                </button>
              )}
            </>
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
            {isNotFound ? (
              <div className="empty-state">
                <h2>Conversation not found</h2>
                <p>This Conversation is unavailable.</p>
              </div>
            ) : isLoadingConversation ? (
              <p role="status">Loading conversation…</p>
            ) : nextMessageCursor ? (
              <button type="button" disabled={isStreaming || isLoadingOlderMessages} onClick={() => void loadOlderMessages()}>
                {isLoadingOlderMessages ? "Loading older messages…" : "Load older messages"}
              </button>
            ) : null}
            {!isNotFound && !isLoadingConversation && messages.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">✦</span>
                <h2>Start a conversation</h2>
                <p>Ask anything and watch the answer arrive in real time.</p>
              </div>
            ) : !isNotFound && !isLoadingConversation ? (
              messages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  <span className="message-role">{message.role === "user" ? "You" : "AI"}</span>
                  <p>{message.content || (isStreaming && message.role === "assistant" ? "…" : "")}</p>
                  {message.status && message.status !== "complete" && (
                    <span className="message-status">{message.status}</span>
                  )}
                </article>
              ))
            ) : null}
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
              disabled={isStreaming || isNotFound}
            />
            {isStreaming ? (
              <button className="stop-button" type="button" onClick={handleStop}>Stop</button>
            ) : (
              <button type="submit" disabled={!input.trim() || isNotFound}>Send</button>
            )}
          </form>
          <p className="composer-hint">Press Enter to send · Shift + Enter for a new line</p>
        </section>
      </section>
    </main>
  );
}

function readRoute(): Route {
  const path = window.location.pathname;
  if (path === "/") return { kind: "new", path: "/" };

  const match = /^\/conversations\/([^/]+)$/.exec(path);
  if (!match) return { kind: "not-found", path };

  let conversationId: string;
  try {
    conversationId = decodeURIComponent(match[1]!);
  } catch {
    return { kind: "not-found", path };
  }
  return /^\d+$/.test(conversationId)
    ? conversationRoute(conversationId)
    : { kind: "not-found", path };
}

function conversationRoute(conversationId: string): Route {
  return {
    kind: "conversation",
    id: conversationId,
    path: `/conversations/${encodeURIComponent(conversationId)}`,
  };
}

function toChatMessage(message: ConversationMessage): ChatMessage {
  return { id: message.id, role: message.role, content: message.content, status: message.status };
}

function mergeById<T extends { id: string | number }>(first: T[], second: T[]): T[] {
  const seen = new Set<string | number>();
  return [...first, ...second].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
