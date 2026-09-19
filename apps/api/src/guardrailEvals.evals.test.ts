import { LLMTestCase } from "deepeval/test-case";
import "deepeval/vitest";
import { describe, expect, it } from "vitest";
import { createGuardrailService } from "./guardrailService.js";
import {
  createGuardrailMetrics,
  guardrailEvaluationCases,
  serializeGuardrailResult,
} from "./guardrailEvals.js";

const guardrailService = createGuardrailService();

describe("Bedrock Guardrail version 1", () => {
  for (const evaluationCase of guardrailEvaluationCases) {
    it(evaluationCase.name, async () => {
      const result = await guardrailService.evaluate(evaluationCase.input);
      const testCase = new LLMTestCase({
        name: evaluationCase.name,
        input: evaluationCase.input,
        actualOutput: serializeGuardrailResult(result),
      });

      await expect(testCase).toPass(createGuardrailMetrics(evaluationCase));
    }, 120_000);
  }
});
