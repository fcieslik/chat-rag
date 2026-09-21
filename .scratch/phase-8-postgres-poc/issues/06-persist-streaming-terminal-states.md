# 06: Persist aborted and failed streaming outcomes

**What to build:** Ensure every started assistant Message reaches a meaningful terminal state when the User stops, the connection closes, or the model fails, while retaining partial output for the history and preventing terminal-state races.

**Blocked by:** 05: Continue a Conversation with persisted context.

**Status:** ready-for-agent

- [ ] Explicit Stop and client disconnect cancel the provider request and conditionally update the pending assistant Message to aborted.
- [ ] Provider or stream parsing failure conditionally updates the pending assistant Message to error.
- [ ] Buffered partial assistant content is stored for both aborted and error outcomes without per-chunk database writes.
- [ ] Completion, failure, and disconnect updates affect only a pending Message so that the first terminal result wins.
- [ ] Errors before SSE headers use a JSON error response; errors after streaming begins use a typed failed terminal event.
- [ ] Stored aborted and error Messages remain returned by history endpoints but remain excluded from model context.
- [ ] The frontend retains and labels partial aborted or failed output instead of deleting the assistant Message.
- [ ] New chat and Conversation switching remain disabled during streaming and become available after the stream settles.
- [ ] Tests cover explicit cancellation, response close, provider failure before and after the first delta, retained partial text, and completion/disconnect races.
