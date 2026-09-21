# 07: Make Turn delivery idempotent

**What to build:** Make transport retries safe for both first-Conversation creation and later Turns, returning the already stored outcome rather than creating another Conversation, user Message, assistant Message, or model invocation.

**Blocked by:** 05: Continue a Conversation with persisted context; 06: Persist aborted and failed streaming outcomes.

**Status:** ready-for-agent

- [ ] A client message UUID is globally unique when present, including before a Conversation identifier exists.
- [ ] The assistant Message has one unambiguous reply relationship to the user Message for recovery of the stored Turn.
- [ ] A duplicate completed Turn returns `200` and replays the persisted assistant content through typed SSE without rerunning the guardrail or model.
- [ ] A duplicate pending, error, or aborted Turn returns `409` without changing stored data or invoking external services.
- [ ] Deliberate regeneration requires a new client UUID.
- [ ] A UUID collision belonging to another User does not disclose ownership or return that User’s content.
- [ ] Concurrent first-Conversation requests with one UUID result in one Conversation and one Turn.
- [ ] Concurrent later requests with one UUID result in one Turn.
- [ ] Integration tests cover every stored status, first-Conversation retry, later retry, cross-User collision behavior, and concurrent delivery.
