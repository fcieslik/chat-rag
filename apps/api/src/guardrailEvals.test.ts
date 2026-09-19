import { LLMTestCase } from "deepeval/test-case";
import "deepeval/vitest";
import { describe, expect, it } from "vitest";
import {
  GuardrailActionMetric,
  GuardrailContentFilterMetric,
  guardrailEvaluationCases,
  serializeGuardrailResult,
} from "./guardrailEvals.js";

describe("Guardrail evaluation corpus", () => {
  it("contains six permitted and six targeted blocked synthetic cases", () => {
    const permitted = guardrailEvaluationCases.filter(
      (evaluationCase) => evaluationCase.expectedAction === "NONE",
    );
    const blocked = guardrailEvaluationCases.filter(
      (evaluationCase) => evaluationCase.expectedAction === "GUARDRAIL_INTERVENED",
    );

    expect(permitted).toHaveLength(6);
    expect(blocked).toHaveLength(6);
    expect(blocked.map((evaluationCase) => evaluationCase.expectedContentFilters))
      .toEqual([
        ["VIOLENCE"],
        ["PROMPT_ATTACK"],
        ["MISCONDUCT"],
        ["HATE"],
        ["SEXUAL"],
        ["INSULTS"],
      ]);
    expect(guardrailEvaluationCases.every((evaluationCase) => evaluationCase.input.length > 0))
      .toBe(true);
  });
});

describe("Guardrail metrics", () => {
  it("passes a permitted result through the DeepEval matcher", async () => {
    const testCase = new LLMTestCase({
      input: "safe question",
      actualOutput: serializeGuardrailResult({
        action: "NONE",
        detectedTopics: [],
        detectedPii: [],
        detectedContentFilters: [],
        latencyMs: 10,
      }),
    });

    await expect(testCase).toPass([new GuardrailActionMetric("NONE")]);
  });

  it("reports a binary failed action score with a useful reason", async () => {
    const metric = new GuardrailActionMetric("GUARDRAIL_INTERVENED");
    const testCase = new LLMTestCase({
      input: "safe question",
      actualOutput: serializeGuardrailResult({
        action: "NONE",
        detectedTopics: [],
        detectedPii: [],
        detectedContentFilters: [],
        latencyMs: 10,
      }),
    });

    await expect(metric.measure(testCase)).resolves.toBe(0);

    expect(metric.threshold).toBe(1);
    expect(metric.score).toBe(0);
    expect(metric.success).toBe(false);
    expect(metric.reason).toBe(
      'Expected action "GUARDRAIL_INTERVENED", received "NONE".',
    );
  });

  it("requires expected filters but permits additional detections", async () => {
    const metric = new GuardrailContentFilterMetric(["VIOLENCE"]);
    const testCase = new LLMTestCase({
      input: "unsafe question",
      actualOutput: serializeGuardrailResult({
        action: "GUARDRAIL_INTERVENED",
        detectedTopics: [],
        detectedPii: [],
        detectedContentFilters: ["VIOLENCE", "MISCONDUCT"],
        latencyMs: 10,
      }),
    });

    await expect(metric.measure(testCase)).resolves.toBe(1);

    expect(metric.threshold).toBe(1);
    expect(metric.score).toBe(1);
    expect(metric.success).toBe(true);
    expect(metric.reason).toBe(
      "Expected content filters: VIOLENCE. Detected: VIOLENCE, MISCONDUCT.",
    );
  });

  it("explains a missing expected content filter", async () => {
    const metric = new GuardrailContentFilterMetric(["HATE"]);
    const testCase = new LLMTestCase({
      input: "unsafe question",
      actualOutput: serializeGuardrailResult({
        action: "GUARDRAIL_INTERVENED",
        detectedTopics: [],
        detectedPii: [],
        detectedContentFilters: [],
        latencyMs: 10,
      }),
    });

    await expect(metric.measure(testCase)).resolves.toBe(0);

    expect(metric.success).toBe(false);
    expect(metric.reason).toBe(
      "Expected content filters: HATE. Detected: none. Missing: HATE.",
    );
  });

  it.each(["not json", "{}", '{"action":"INVALID"}'])(
    "rejects malformed serialized Guardrail Results: %s",
    async (actualOutput) => {
      const metric = new GuardrailActionMetric("NONE");
      const testCase = new LLMTestCase({ input: "question", actualOutput });

      await expect(metric.measure(testCase)).rejects.toThrow(
        "Guardrail evaluation result",
      );
    },
  );
});
