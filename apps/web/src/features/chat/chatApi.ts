const apiUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const conversationsEndpoint = `${apiUrl}/v1/conversations`;

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  activityAt: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  status: "pending" | "complete" | "error" | "aborted";
  content: string;
  metadata: Record<string, unknown>;
  replyToMessageId: string | null;
  createdAt: string;
}

interface ChatStreamEvent {
  delta?: unknown;
  conversationId?: unknown;
  userMessageId?: unknown;
  assistantMessageId?: unknown;
}

export interface TurnStartedEvent {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
}

export class AuthenticationError extends Error {
  constructor() {
    super("Your session is no longer valid. Please sign in again.");
    this.name = "AuthenticationError";
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "The chat request failed.";
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  if (!accessToken) {
    throw new Error("Authentication is required.");
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 401) {
    throw new AuthenticationError();
  }
  if (!response.ok) {
    throw new Error("The conversation could not be loaded.");
  }
  return response.json() as Promise<T>;
}

export async function listConversations(accessToken: string): Promise<Conversation[]> {
  const response = await getJson<{ conversations: Conversation[] }>(
    conversationsEndpoint,
    accessToken,
  );
  return response.conversations;
}

export async function listConversationMessages(
  conversationId: string,
  accessToken: string,
): Promise<ConversationMessage[]> {
  const response = await getJson<{ messages: ConversationMessage[] }>(
    `${conversationsEndpoint}/${encodeURIComponent(conversationId)}/messages`,
    accessToken,
  );
  return response.messages;
}

export async function streamConversationResponse(
  input: {
    conversationId: string | null;
    message: string;
    clientMessageId: string;
    accessToken: string;
    onTurnStarted: (turn: TurnStartedEvent) => void;
    onDelta: (delta: string) => void;
    signal: AbortSignal;
  },
): Promise<void> {
  if (!input.accessToken) {
    throw new Error("Authentication is required.");
  }

  const endpoint = input.conversationId
    ? `${conversationsEndpoint}/${encodeURIComponent(input.conversationId)}/messages`
    : conversationsEndpoint;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: input.message, clientMessageId: input.clientMessageId }),
    signal: input.signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthenticationError();
    }

    let details = "The chat request failed.";

    try {
      const errorBody = (await response.json()) as { error?: unknown };
      if (typeof errorBody.error === "string") {
        details = errorBody.error;
      }
    } catch {
      // Keep the generic message when the API does not return JSON.
    }

    throw new Error(details);
  }

  if (!response.body) {
    throw new Error("The API returned an empty response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";

      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trimStart())
          .join("\n");

        if (!data) {
          continue;
        }

        const parsed = JSON.parse(data) as ChatStreamEvent;
        const eventName = event
          .split(/\r?\n/)
          .find((line) => line.startsWith("event:"))
          ?.slice("event:".length)
          .trim();
        if (
          eventName === "turn.started" &&
          typeof parsed.conversationId === "string" &&
          typeof parsed.userMessageId === "string" &&
          typeof parsed.assistantMessageId === "string"
        ) {
          input.onTurnStarted(parsed as TurnStartedEvent);
        }
        if (typeof parsed.delta === "string") {
          input.onDelta(parsed.delta);
        }
      }

      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      const data = buffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");

      if (data) {
        const parsed = JSON.parse(data) as ChatStreamEvent;
        if (typeof parsed.delta === "string") {
          input.onDelta(parsed.delta);
        }
      }
    }
  } catch (error) {
    if (input.signal.aborted) {
      return;
    }

    throw new Error(getErrorMessage(error));
  } finally {
    reader.releaseLock();
  }
}
