import type { ApplyGuardrailCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  createGuardrailService,
  type GuardrailClient,
} from "./guardrailService.js";

function createClient(response: ApplyGuardrailCommandOutput): GuardrailClient {
  return {
    send: vi.fn().mockResolvedValue(response),
  };
}

const configuration = {
  BEDROCK_GUARDRAIL_ID: "wrbzgwf3rz1e",
  BEDROCK_GUARDRAIL_VERSION: "1",
  AWS_REGION: "eu-central-1",
};

describe("Guardrail Service", () => {
  it("normalizes a permitted full Bedrock assessment", async () => {
    const client = createClient({
      action: "NONE",
      usage: {},
      outputs: [],
      assessments: [
        {
          contentPolicy: {
            filters: [
              {
                type: "VIOLENCE",
                confidence: "LOW",
                action: "NONE",
                detected: false,
              },
            ],
          },
        },
      ],
    });
    const service = createGuardrailService({ environment: configuration, client });

    const result = await service.evaluate("What is the capital of Poland?");

    expect(result).toMatchObject({
      action: "NONE",
      detectedTopics: [],
      detectedPii: [],
      detectedContentFilters: [],
    });
    expect(result.outputText).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        guardrailIdentifier: "wrbzgwf3rz1e",
        guardrailVersion: "1",
        source: "INPUT",
        outputScope: "FULL",
        content: [{ text: { text: "What is the capital of Poland?" } }],
      }),
    }));
  });

  it("normalizes every detected policy signal when the guardrail intervenes", async () => {
    const client = createClient({
      action: "GUARDRAIL_INTERVENED",
      usage: {},
      outputs: [{ text: "Sorry, the model cannot answer this question." }],
      assessments: [
        {
          topicPolicy: {
            topics: [
              { name: "Financial Advice", type: "DENY", action: "BLOCKED", detected: true },
              { name: "Allowed topic", type: "DENY", action: "NONE", detected: false },
            ],
          },
          contentPolicy: {
            filters: [
              { type: "VIOLENCE", confidence: "HIGH", action: "BLOCKED", detected: true },
              { type: "MISCONDUCT", confidence: "HIGH", action: "BLOCKED", detected: true },
            ],
          },
          sensitiveInformationPolicy: {
            piiEntities: [
              { match: "john@example.com", type: "EMAIL", action: "BLOCKED", detected: true },
              { match: "Jane", type: "NAME", action: "ANONYMIZED", detected: false },
            ],
            regexes: [],
          },
        },
      ],
    });
    const service = createGuardrailService({ environment: configuration, client });

    const result = await service.evaluate("How can I physically hurt someone?");

    expect(result).toMatchObject({
      action: "GUARDRAIL_INTERVENED",
      detectedTopics: ["Financial Advice"],
      detectedPii: [{ type: "EMAIL" }],
      detectedContentFilters: ["VIOLENCE", "MISCONDUCT"],
      outputText: "Sorry, the model cannot answer this question.",
    });
  });

  it("propagates an AWS failure", async () => {
    const client: GuardrailClient = {
      send: vi.fn().mockRejectedValue(new Error("AWS unavailable")),
    };
    const service = createGuardrailService({ environment: configuration, client });

    await expect(service.evaluate("hello")).rejects.toThrow("AWS unavailable");
  });
});
