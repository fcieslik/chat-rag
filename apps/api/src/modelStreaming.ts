const openAiChatCompletionsUrl = "https://api.openai.com/v1/chat/completions";
export const openAiModel = "gpt-5.6-luna";

export interface ModelMessage {
  role: "assistant" | "system" | "user";
  content: string;
}

export interface ModelStreamRequest {
  messages: readonly ModelMessage[];
  signal: AbortSignal;
}

export interface ModelStreamingService {
  start(request: ModelStreamRequest): Promise<AsyncIterable<string>>;
}

export class ModelStreamingResponseError extends Error {
  constructor(
    readonly kind: "empty_stream" | "request_failed",
    readonly details?: string,
  ) {
    super(kind);
    this.name = "ModelStreamingResponseError";
  }
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: unknown;
    };
  }>;
}

async function* readDeltas(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");

      if (!data || data === "[DONE]") {
        continue;
      }

      const chunk = JSON.parse(data) as ChatCompletionChunk;
      const delta = chunk.choices?.[0]?.delta?.content;

      if (typeof delta === "string") {
        yield delta;
      }
    }
  }
}

export function createModelStreamingService(
  fetchImplementation: typeof fetch = globalThis.fetch,
): ModelStreamingService {
  return {
    async start({ messages, signal }) {
      const response = await fetchImplementation(openAiChatCompletionsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openAiModel,
          messages,
          stream: true,
        }),
        signal,
      });

      if (!response.ok) {
        throw new ModelStreamingResponseError(
          "request_failed",
          await response.text(),
        );
      }

      if (!response.body) {
        throw new ModelStreamingResponseError("empty_stream");
      }

      return readDeltas(response.body);
    },
  };
}
