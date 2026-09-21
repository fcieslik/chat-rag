---
status: accepted
---

# Conversation writes share one streaming use case

Creating a conversation with its first message and adding a later message are two entry points to one streaming send use case. `POST /v1/conversations` evaluates the first message and atomically creates the conversation and its first turn, while `POST /v1/conversations/:conversationId/messages` appends later turns; the superseded `POST /v1/chat` is removed with the coordinated frontend change. This avoids empty conversations without duplicating ownership, persistence, or streaming behavior. A globally unique, client-generated message UUID makes creation and later sends idempotent even before a conversation ID exists, and the assistant message explicitly references the user message it answers so a retry can recover the same turn safely. A duplicate completed turn is replayed as SSE with `200`; a duplicate still pending, failed, or aborted turn returns `409`, and deliberately generating another response requires a new client message identifier.
