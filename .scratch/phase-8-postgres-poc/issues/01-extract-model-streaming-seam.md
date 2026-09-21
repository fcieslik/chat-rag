# 01: Extract a testable model streaming seam

**What to build:** Preserve the current authenticated streaming chat behavior while moving provider invocation and chunk delivery behind a small injectable interface. This prefactor must make persistence-aware HTTP tests able to control successful chunks, provider failures, and cancellation without replacing the global network client.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Existing authenticated chat behavior, input guardrail ordering, fallback streaming, and failure responses remain unchanged.
- [ ] The Express application accepts an injected model streaming dependency with a production default.
- [ ] Tests drive successful streaming, provider failure, and cancellation through the new seam without mocking global network access.
- [ ] Existing API tests, type checks, and builds remain green.
