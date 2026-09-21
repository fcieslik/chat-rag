# 08: Page Conversation and Message history with keysets

**What to build:** Let Users navigate histories larger than one page without offset drift, duplicated rows, or missing rows, using explicit Load more controls in the Conversation list and Message history.

**Blocked by:** 04: Reopen owned Conversations after refresh.

**Status:** ready-for-agent

- [ ] Conversation listing defaults to 20 items, accepts at most 100, and orders by activity timestamp descending then identity descending.
- [ ] The opaque Conversation cursor contains both ordering values and invalid cursors receive a validation error.
- [ ] Message listing initially selects the newest 50 records, accepts at most 100, and returns each page chronologically.
- [ ] The opaque Message cursor requests an older page using creation timestamp and identity as the stable keyset.
- [ ] Cursor traversal produces no duplicate or missing records when ordering timestamps tie.
- [ ] Pagination remains fully scoped to the authenticated User and excludes soft-deleted Conversations.
- [ ] API responses expose the next cursor only when another page exists.
- [ ] The frontend provides Load more Conversations and Load older messages controls, preserving active selection and chronological display as pages are merged.
- [ ] HTTP and frontend tests cover defaults, maximums, invalid limits, invalid cursors, tied timestamps, exhausted pages, and page merging.
