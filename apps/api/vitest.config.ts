import { defineConfig } from "vitest/config";

const isGuardrailEvaluationRun = process.env.GUARDRAIL_EVALUATION_RUN === "1";

export default defineConfig({
  test: {
    environment: "node",
    include: isGuardrailEvaluationRun
      ? ["src/guardrailEvals.evals.test.ts"]
      : ["src/**/*.test.ts"],
    exclude: isGuardrailEvaluationRun ? [] : ["src/**/*.evals.test.ts"],
  },
});
