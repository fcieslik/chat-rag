# 03: Create and persist the first Conversation

**What to build:** Let an authenticated User submit the first Message from New chat, pass the existing input guardrail, atomically create the User, Conversation, and first Turn, stream the assistant response, and recover the completed Conversation from PostgreSQL.

**Blocked by:** 01: Extract a testable model streaming seam; 02: Run local PostgreSQL and role-separated migrations.

**Status:** ready-for-agent

- [ ] A verified Cognito Access Token must contain a non-empty subject before the request reaches persistence.
- [ ] First use creates one local User for the Cognito subject; repeated use resolves the same User without profile backfill.
- [ ] Conversation creation accepts a trimmed 1–10,000-character Message and a client-generated UUID.
- [ ] Input guardrail intervention preserves the existing fallback experience, does not invoke the model, and creates no Conversation or Message records.
- [ ] Accepted input creates the Conversation, complete user Message, and pending assistant Message in one short transaction after the guardrail succeeds.
- [ ] The Conversation title is set once from the normalized first 80 characters and activity time is updated with Turn creation.
- [ ] The model transaction is closed before provider streaming begins.
- [ ] Typed SSE announces the Conversation, user Message, and assistant Message identifiers before deltas, then emits a completed terminal event.
- [ ] Normal completion buffers the response and performs one conditional update from pending to complete.
- [ ] Database identifiers are serialized to the client as strings.
- [ ] New chat remains local until the first Turn-started event selects the persisted Conversation.
- [ ] HTTP integration tests use real PostgreSQL and controlled guardrail/model dependencies to verify atomic persistence, validation, titles, SSE, and no empty Conversation on intervention.
