# 02: Local deterministic Guardrail evals

**What to build:** A developer with an active AWS SSO session can run one local command that directly evaluates the Guardrail Service module used by the chat route. The suite uses a checked-in synthetic corpus to verify permitted and blocked behavior for every configured content filter, with deterministic DeepEval metrics and no LLM judge.

**Blocked by:** 01: Extract Guardrail Service and pin version 1.

**Status:** resolved

- [x] The project provides a dedicated local Guardrail-evaluation command using the TypeScript DeepEval development dependency.
- [x] Every live case makes one ordinary Guardrail Service call; the suite does not construct an HTTP request, an Express application, or an SSE stream.
- [x] The suite contains six permitted synthetic cases and six targeted blocked synthetic cases for `VIOLENCE`, `PROMPT_ATTACK`, `MISCONDUCT`, `HATE`, `SEXUAL`, and `INSULTS`.
- [x] Action and content-filter metrics return a binary score, threshold, pass/fail state, and useful reason without re-calling AWS or invoking an LLM.
- [x] A blocked case requires every expected filter but accepts additional detected filters; a safe case fails when the action is unexpectedly an intervention.
- [x] Metric and dataset tests cover malformed serialized results and expected failure reasons without depending on live AWS.
