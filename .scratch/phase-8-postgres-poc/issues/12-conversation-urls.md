# 12: Make Conversation URLs navigable and refresh-safe

**What to build:** Give each saved Conversation a stable browser URL so a User can switch threads, refresh, share a link with their own account, and use Back/Forward without losing the selected history. Keep `/` as the empty New chat state.

**Blocked by:** 04: Reopen owned Conversations after refresh; 08: Page Conversation and Message history with keysets; 11: Retire stateless chat and verify the complete POC.

**Status:** ready-for-agent

- [ ] `/` displays the empty New chat state after startup or refresh, while still listing the authenticated User's Conversations. It no longer auto-selects the newest Conversation; this explicitly supersedes that frontend behavior from ticket 04 and the original POC spec.
- [ ] `/conversations/:id` loads that owned Conversation and its newest Message page on direct entry and refresh, and highlights it in the sidebar.
- [ ] A deep link works even when the Conversation is older than the first page of the sidebar list: fetch its details through the existing owned-Conversation API rather than assuming it appears in the initial list.
- [ ] Clicking a Conversation updates the URL to `/conversations/:id`; clicking `New chat` returns to `/` and clears the selected history without creating a database row.
- [ ] After the first Turn starts and returns a new Conversation ID, replace the empty-state URL with `/conversations/:id` without adding a redundant Back entry for the unsaved draft.
- [ ] Browser Back/Forward restores the selected Conversation or New chat state and its Messages. Pending loads cannot overwrite a more recently selected route.
- [ ] A missing, foreign, deleted, or malformed Conversation ID does not fall back to another User's Conversation or silently select the newest one; show a safe not-found state without exposing ownership details.
- [ ] Direct entry to `/conversations/:id` while signed out survives the Cognito login redirect and opens that Conversation after authentication. Callback processing removes OAuth query parameters without discarding the target route.
- [ ] Navigation during streaming cannot leave the URL, selected Conversation, and displayed Messages out of sync; preserve the existing Stop/aborted behavior if an in-flight stream must be interrupted.
- [ ] Frontend tests cover `/` after refresh, deep-linked Conversation inside and outside the first list page, switching, New chat, first-Turn URL adoption, Back/Forward, invalid/inaccessible IDs, login return path, and an in-flight stream navigation race.
- [ ] Verify direct loading of `/conversations/:id` in both Vite development and the production Nginx SPA fallback. No PostgreSQL migration, new backend endpoint, router dependency, or infrastructure change is required unless verification reveals a concrete need.
