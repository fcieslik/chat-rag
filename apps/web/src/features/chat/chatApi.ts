const apiUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const chatEndpoint =
  import.meta.env.VITE_CHAT_API_URL?.trim() || `${apiUrl}/v1/chat`;

interface ChatStreamEvent {
  delta?: unknown;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "The chat request failed.";
}

export async function streamChatResponse(
  message: string,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(chatEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!response.ok) {
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

        if (data === "[DONE]") {
          return;
        }

        const parsed = JSON.parse(data) as ChatStreamEvent;
        if (typeof parsed.delta === "string") {
          onDelta(parsed.delta);
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

      if (data && data !== "[DONE]") {
        const parsed = JSON.parse(data) as ChatStreamEvent;
        if (typeof parsed.delta === "string") {
          onDelta(parsed.delta);
        }
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    throw new Error(getErrorMessage(error));
  } finally {
    reader.releaseLock();
  }
}
