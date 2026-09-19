# 01: Extract Guardrail Service and pin version 1

**What to build:** The chat route obtains its input-guardrail decision from a dedicated Guardrail Service module. Its small interface evaluates one message and returns an application-owned Guardrail Result with the action, detected content filters, future-policy fields, blocked output text, and latency. Runtime configuration consistently evaluates immutable guardrail version `1` instead of `DRAFT`.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The route obtains its guardrail decision from the Guardrail Service interface without changing its existing chat-flow behavior.
- [x] Guardrail Result normalizes full Bedrock assessment data, including multiple detected filters and absent optional policy types, without exposing the AWS SDK response to callers.
- [x] All application runtime configuration and operational documentation refer to guardrail version `1`.
- [x] Direct module tests cover normalization, a permitted result, an intervention result, and an AWS failure without constructing the chat application or parsing SSE.
