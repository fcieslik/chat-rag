# 05: Continue a Conversation with persisted context

**What to build:** Let a User append a Turn to an owned Conversation while the model receives a bounded, chronologically correct history and concurrent requests cannot generate two assistant responses in the same Conversation.

**Blocked by:** 04: Reopen owned Conversations after refresh.

**Status:** ready-for-agent

- [ ] The append operation accepts the same validated Message and client UUID contract as first-Conversation creation.
- [ ] Ownership, soft-deletion state, stale-pending cleanup, active-pending rejection, context loading, and Turn insertion are coordinated through the repository transaction rather than separate handler queries.
- [ ] A Conversation row lock and database uniqueness guarantee at most one pending assistant Message per Conversation across ECS tasks.
- [ ] Pending assistant Messages older than ten minutes are conditionally changed to aborted before a new Turn is accepted.
- [ ] A newer pending assistant Message causes `409` without invoking the model or inserting another Turn.
- [ ] Model input contains no more than the 20 most recent complete persisted Messages in chronological order followed by the current user Message.
- [ ] Pending, error, and aborted assistant Messages never enter model context.
- [ ] The append path reuses the same validation, typed SSE, streaming, and terminal-update use case as first-Conversation creation.
- [ ] The frontend sends subsequent Messages to the selected Conversation and immediately moves the active Conversation to the top of the sidebar.
- [ ] Tests cover context ordering and limit, status filtering, foreign ownership, concurrent sends, fresh pending rejection, and stale pending recovery.
