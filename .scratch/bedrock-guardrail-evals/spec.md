Status: ready-for-agent

# Bedrock Guardrail evaluations

## Problem Statement

Chat RAG uses an input guardrail before it calls the language model, but it has no repeatable way to prove that the versioned guardrail policy makes the expected decisions. This is particularly important because Bedrock manages and can update the models underlying its guardrail mechanisms without a corresponding application-code change. The current route invokes AWS directly and reduces the response to a boolean, which prevents deterministic checks of detected policy signals.

The project needs a CI-visible, version-pinned evaluation suite that exercises the same input guardrail integration as production, detects unexpected changes in its decisions, and explains precisely which expected policy signal was missing.

## Solution

Extract an application-owned Guardrail Service module that evaluates a message through Bedrock and normalizes the response into a Guardrail Result. The route will use this module, but the evaluation suite will test only the module's interface with an ordinary call; it will not exercise HTTP, SSE, authentication, OpenAI, or the complete chat flow.

Add a TypeScript DeepEval suite that submits a checked-in dataset of synthetic inputs to the versioned guardrail and evaluates the normalized result with deterministic custom metrics. The suite will run locally through a dedicated pnpm command and in GitHub Actions through the existing OIDC role. It will fail on an unexpected result; maintainers must review and commit any intentional expectation change.

The reference policy is Bedrock guardrail `wrbzgwf3rz1e`, version `1`, in `eu-central-1`. Its current input content policy blocks `VIOLENCE`, `PROMPT_ATTACK`, `MISCONDUCT`, `HATE`, `SEXUAL`, and `INSULTS` at high strength.

## User Stories

1. As a maintainer, I want every production input guardrail check to use a Guardrail Service module that returns a Guardrail Result, so that the application owns a stable contract instead of exposing AWS SDK details.
2. As a maintainer, I want the Guardrail Service interface to be the sole subject of Guardrail evals, so that a policy result is tested without unrelated chat-flow concerns.
3. As an API operator, I want the route and the eval suite to call the same Guardrail Service module, so that passing evals demonstrate the production AWS integration rather than a separate test-only implementation.
4. As a maintainer, I want the guardrail policy version to be `1` in all runtime configuration, so that the API and eval suite do not silently use mutable `DRAFT` behavior.
5. As an evaluator, I want a Guardrail Action metric, so that each input deterministically verifies whether the action is `NONE` or `GUARDRAIL_INTERVENED`.
6. As an evaluator, I want a Guardrail Content Filter metric, so that a blocked input verifies the relevant detected content-policy filter or filters.
7. As an evaluator, I want custom metrics to consume the Guardrail Result without invoking an LLM judge, so that assertions are inexpensive, deterministic, and reproducible.
8. As a maintainer, I want the suite to require every expected filter while tolerating additional detected filters, so that valid multi-policy detections do not create false failures.
9. As a maintainer, I want a safe-input corpus, so that unexpected interventions reveal false positives.
10. As a maintainer, I want a targeted blocked-input corpus for each configured filter, so that loss of a configured safety behavior reveals false negatives.
11. As a security-conscious maintainer, I want test inputs to use only synthetic PII and controlled short prompts, so that no user data is committed to the repository or emitted in CI logs.
12. As a local developer, I want one documented command to run Guardrail evaluations after AWS SSO login, so that I can reproduce CI behavior before pushing.
13. As a CI operator, I want guardrail evals to run on every existing branch push, so that a change in application integration or in AWS-managed guardrail behavior is visible before deployment.
14. As a cloud-security administrator, I want the evaluation job to use the existing GitHub Actions OIDC role with only `bedrock:ApplyGuardrail`, so that no long-lived AWS credential is stored in GitHub.
15. As a maintainer, I want a failed evaluation caused by changed AWS behavior to block CI until reviewed, so that managed-model updates are never silently accepted.
16. As a maintainer, I want expectation changes to be explicit repository changes, so that the guardrail behavior baseline has a reviewable history.
17. As a future policy owner, I want the Guardrail Result to accommodate topic and PII signals, so that the integration can support those policy types when they are enabled.
18. As a future evaluator, I want topic and PII metrics deferred until their corresponding Bedrock policies are configured, so that the initial suite contains only executable assertions over real policy behavior.
19. As a performance owner, I want Guardrail Result latency available to later benchmarks, so that p50, p95, p99, and error-rate analysis can be added without changing the service contract.

## Implementation Decisions

- Add `deepeval` version `0.9.16` as a root development dependency and expose a dedicated `eval:guardrails` pnpm command. Evaluation tooling must not become a production runtime dependency.
- Establish one highest integration seam: the Guardrail Service module interface. It accepts a message and returns a Guardrail Result; both the route and the DeepEval suite use it.
- A Guardrail Result owns the normalized action, detected topics, detected PII, detected content filters, optional blocked output text, and guardrail latency. It must not leak the AWS SDK response shape to consumers.
- The Guardrail Service calls `ApplyGuardrail` with input source and full output scope. It aggregates detected policy signals from the returned assessments and maps unknown or absent policy data to empty collections.
- The route continues to decide its response from the normalized action. Its existing streaming behavior is not part of this evaluation work and is covered by separate API-flow tests. No output, RAG, conversation-history, or OpenAI-response guardrail evaluation is added.
- The application invokes the configured immutable guardrail version `1`; all local, container, ECS, and documentation configuration must stop referring to `DRAFT`.
- DeepEval test cases receive the input and a serialized Guardrail Result as their actual output because the TypeScript test-case contract is text-based. Custom metrics deserialize this value and do not call an LLM.
- Each deterministic metric sets a binary score, a threshold of `1`, a success flag, and a precise reason. The action metric compares the normalized action; the content-filter metric requires that all expected filters are present.
- The initial dataset contains twelve checked-in synthetic cases: six safe inputs expected to be permitted and six blocked inputs targeted at the six configured content filters. Prompts may intentionally produce additional filters; expected filters are therefore an inclusion requirement, not an exact set.
- Topic and PII extraction fields remain part of the normalized domain contract, but Topic and PII custom metrics and cases are deferred. Guardrail version `1` has neither a topic policy nor a sensitive-information policy.
- False-positive rate, false-negative rate, and latency percentile thresholds are deferred until a substantially larger balanced dataset exists. The initial suite reports per-case correctness only.
- Add a separate blocking GitHub Actions evaluation job on the workflow's current branch-push triggers. It uses the existing `chat-rag-github-actions` OIDC role and supplies the guardrail region, identifier, and version as non-secret configuration.
- The OIDC role must receive least-privilege permission for `bedrock:ApplyGuardrail` on the configured guardrail. This IAM policy is managed manually outside the repository and documented as a prerequisite.
- An AWS service failure, expired credentials, or an unexpected result fails the evaluation job. A change to expected behavior is accepted only through a reviewed dataset update.
- Record the architecture decision and local/CI operational instructions in project documentation.

## Testing Decisions

- The primary and only live seam of this suite is Guardrail Service evaluation: each DeepEval case calls its interface once and then evaluates the resulting Guardrail Result. Metrics must not re-send the prompt to AWS or invoke an LLM.
- Unit tests cover the module's AWS-response normalization with mocked SDK responses, including multiple assessments, multiple detected filters, no detections, missing optional policies, latency, and AWS failures.
- The DeepEval suite is a component integration evaluation, not an end-to-end test. It uses AWS SSO locally and GitHub Actions OIDC in CI against guardrail version `1`.
- The suite must not create an Express application, issue an HTTP request, parse SSE, authenticate a request, call OpenAI, or assert fallback-message behavior. Those concerns belong to separate API-flow tests.
- A good safe-input test verifies `NONE`; a good blocked-input test verifies `GUARDRAIL_INTERVENED` and all explicitly expected filters. It does not assert that the detected-filter set contains no additional values.
- Tests must use only synthetic, short controlled inputs. The suite must never require an OpenAI API key because its metrics are deterministic and do not use an LLM judge.
- The existing Vitest-based API tests are prior art for test organization and mocking. DeepEval's TypeScript Vitest integration is used only for the separate guardrail-evaluation command.

## Out of Scope

- Adding or changing Bedrock topic, sensitive-information/PII, word, contextual-grounding, or automated-reasoning policies.
- Topic, PII, false-positive-rate, false-negative-rate, and latency-percentile metrics in the initial delivery.
- Output guardrails, RAG-context guardrails, history guardrails, OpenAI-response evaluation, LLM-as-a-Judge metrics, and user-facing fallback-message quality evaluation.
- Creating, applying, or changing AWS IAM policies, OIDC trust relationships, Secrets Manager values, or the guardrail configuration outside this repository.
- Persisting results in Confident AI or using DeepEval synthetic dataset generation, red-teaming, prompt optimization, or benchmarks.

## Further Notes

- The configured guardrail is `READY` and uses the standard content-policy tier. A safe prompt produced action `NONE`; a synthetic physical-harm prompt produced `GUARDRAIL_INTERVENED` and detected both `VIOLENCE` and `MISCONDUCT`. This validates the inclusion semantics for expected filters.
- Underlying Bedrock guardrail models may change while the guardrail version remains `1`. A CI failure in this suite is therefore an intentional review signal, not a failure to be auto-baselined.
- Local execution requires an active AWS SSO session for the account that owns the guardrail and allows `bedrock:ApplyGuardrail`.
