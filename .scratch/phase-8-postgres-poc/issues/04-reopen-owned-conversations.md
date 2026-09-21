# 04: Reopen owned Conversations after refresh

**What to build:** Let an authenticated User list their persisted Conversations, automatically reopen the newest one after login or refresh, select another thread, and load its stored Messages without learning whether another User’s resource exists.

**Blocked by:** 03: Create and persist the first Conversation.

**Status:** ready-for-agent

- [ ] Authenticated endpoints list Conversations, return one Conversation, and return its Messages.
- [ ] Every lookup and list scopes ownership in the same database statement and excludes soft-deleted Conversations.
- [ ] Foreign, soft-deleted, malformed, and nonexistent Conversation identifiers produce the same `404` behavior where applicable.
- [ ] Conversation results are ordered by activity timestamp descending and identity descending.
- [ ] Message results are returned in chronological order and include role, status, content, metadata, reply identifier, and string identifiers needed by the UI.
- [ ] CORS permits the authenticated GET requests required by the web application.
- [ ] The frontend sidebar shows the current User’s Conversations and highlights the selected Conversation.
- [ ] The newest Conversation opens automatically after authenticated startup; an empty account preserves the New chat empty state.
- [ ] Selecting a Conversation replaces the displayed history with its persisted Messages.
- [ ] Tests demonstrate full isolation between at least two Users across list, Conversation lookup, and Message lookup.
- [ ] Frontend tests cover loading, empty state, newest selection, Conversation switching, authentication failure, and absence of token values from rendered output.
