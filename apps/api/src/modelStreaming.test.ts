import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createModelStreamingService,
  ModelStreamingResponseError,
} from "./modelStreaming.js";

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const values: string[] = [];

  for await (const value of stream) {
    values.push(value);
  }

  return values;
}

describe("OpenAI model streaming service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
  });

  it("invokes the provider and exposes its text deltas", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"hel"}}]}',
          "",
          'data: {"choices":[{"delta":{"content":"lo"}}]}',
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
        { status: 200 },
      ),
    );
    const signal = new AbortController().signal;
    const service = createModelStreamingService(fetchImplementation);

    const stream = await service.start({
      messages: [{ role: "user", content: "hello" }],
      signal,
    });

    await expect(collect(stream)).resolves.toEqual(["hel", "lo"]);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-openai-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
        signal,
      },
    );
  });

  it("reports a rejected provider response with its details", async () => {
    const service = createModelStreamingService(
      vi.fn().mockResolvedValue(
        new Response("rate limited", { status: 429 }),
      ),
    );

    await expect(
      service.start({
        messages: [{ role: "user", content: "hello" }],
        signal: new AbortController().signal,
      }),
    ).rejects.toEqual(
      new ModelStreamingResponseError("request_failed", "rate limited"),
    );
  });

  it("reports an empty provider stream", async () => {
    const service = createModelStreamingService(
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );

    await expect(
      service.start({
        messages: [{ role: "user", content: "hello" }],
        signal: new AbortController().signal,
      }),
    ).rejects.toEqual(new ModelStreamingResponseError("empty_stream"));
  });
});
