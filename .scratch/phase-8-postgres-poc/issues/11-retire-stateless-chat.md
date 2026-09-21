# 11: Retire stateless chat and verify the complete POC

**What to build:** Complete the coordinated contract switch so the product uses only persisted Conversation operations, then verify the full User journey and deployment artifacts as one releasable PostgreSQL persistence POC.

**Blocked by:** 06: Persist aborted and failed streaming outcomes; 07: Make Turn delivery idempotent; 08: Page Conversation and Message history with keysets; 10: Block ECS rollout until migrations succeed.

**Status:** ready-for-agent

- [ ] The web application no longer calls the stateless chat endpoint.
- [ ] The backend removes the stateless endpoint and its obsolete request/response tests only after all call sites use the Conversation API.
- [ ] Input guardrail behavior and its accepted ADR remain unchanged after the contract switch.
- [ ] An authenticated User can start, stream, stop, refresh, reopen, paginate, and continue a Conversation from the browser.
- [ ] A second User cannot observe or mutate the first User’s Conversations or Messages through any endpoint.
- [ ] Complete, error, aborted, duplicate, concurrent, and stale-pending behaviors match the accepted spec.
- [ ] Local reset, migrations, application-role access, API startup, unit tests, PostgreSQL integration tests, frontend tests, type checks, and production builds all pass.
- [ ] The final Task Definitions contain only their intended database secret and reference the same image.
- [ ] The deployment workflow proves that migration failure blocks API rollout and migration success permits it.
- [ ] No summary behavior, deletion API, RAG, output guardrail, or additional infrastructure has entered the POC scope.
