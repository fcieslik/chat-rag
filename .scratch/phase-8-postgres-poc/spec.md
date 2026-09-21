# Phase 8: PostgreSQL Conversation Persistence POC

Status: ready-for-agent

## Problem Statement

Chat RAG currently authenticates users and streams individual OpenAI responses, but the API remains stateless: refreshing the browser loses the conversation, users cannot return to earlier threads, and the model receives no persisted history. PostgreSQL and private ECS-to-RDS connectivity already exist, but the application has no database client, schema, migrations, repositories, persistence-aware chat flow, conversation UI, or deployment gate for database migrations.

The immediate need is a deliberately small persistence POC. An authenticated User must be able to start a Conversation, exchange and persist Messages, reopen prior Conversations, and continue with recent persisted context while remaining fully isolated from other Users. Production-oriented summary generation, retention jobs, retrieval, and broader infrastructure expansion must not delay this result.

## Solution

Add PostgreSQL persistence to the existing authenticated streaming chat. A new Conversation begins atomically with its first accepted user Message and a pending assistant Message. Subsequent Turns append to the same Conversation. Assistant output continues to stream progressively, is buffered in application memory, and is written once with a terminal status when streaming completes, fails, or is aborted.

Expose a small authenticated Conversation API and update the web application with a Conversation sidebar, “New chat”, Conversation loading, and explicit controls for older pages. Resolve the Cognito subject to a local User without trusting client-supplied ownership identifiers. Enforce ownership in every repository query and return `404` for inaccessible resources.

Manage the schema through forward-only Drizzle migrations. Use separate application and migration credentials, a verified TLS connection to RDS, and a one-off ECS migration task that must succeed before the API service is deployed. The same container image serves both purposes through separate commands and Task Definitions.

## User Stories

1. As an authenticated User, I want my first submitted message to create a Conversation, so that I do not need to create an empty thread manually.
2. As an authenticated User, I want a Conversation to be created only after the input guardrail accepts my first message, so that blocked input does not leave an empty stored thread.
3. As an authenticated User, I want my first user Message and its pending assistant Message created atomically, so that a partial database write cannot leave an invalid Turn.
4. As an authenticated User, I want assistant text to appear progressively, so that persistence does not remove the existing streaming experience.
5. As an authenticated User, I want a completed assistant response saved after streaming, so that I can recover it after refreshing the browser.
6. As an authenticated User, I want a stopped response saved as aborted with any text already received, so that the stored history explains what happened.
7. As an authenticated User, I want a failed response shown as failed with any partial text retained, so that my user Message does not silently disappear.
8. As an authenticated User, I want aborted and failed assistant Messages excluded from later model context, so that incomplete output does not influence future answers.
9. As an authenticated User, I want to add more Turns to an existing Conversation, so that I can have a contextual multi-turn chat.
10. As an authenticated User, I want the model to receive recent completed Messages from the selected Conversation, so that follow-up questions make sense.
11. As an authenticated User, I want the model context bounded to the most recent 20 completed Messages, so that a POC Conversation cannot grow beyond the model context indefinitely.
12. As an authenticated User, I want my current message appended after the persisted context sent to the model, so that the model receives the correct chronological input.
13. As an authenticated User, I want to see my Conversations ordered by recent activity, so that the thread I just used appears first.
14. As an authenticated User, I want a Conversation title derived from the first message without another model call, so that the list is recognizable without extra latency or cost.
15. As an authenticated User, I want “New chat” to reset the current draft without immediately creating a database row, so that accidental clicks do not create empty Conversations.
16. As an authenticated User, I want the newest stored Conversation to open after login or refresh, so that I can resume where I left off.
17. As an authenticated User with no Conversations, I want to see the existing empty state, so that I know how to begin.
18. As an authenticated User, I want to select an earlier Conversation, so that I can read and continue it.
19. As an authenticated User, I want to load more Conversations explicitly, so that a long history remains navigable without offset pagination.
20. As an authenticated User, I want to load older Messages explicitly, so that the initial page stays small while older history remains available.
21. As an authenticated User, I want navigation disabled during active streaming, so that I cannot accidentally switch the displayed Conversation while it is being updated.
22. As an authenticated User, I want to stop streaming before navigating elsewhere, so that the assistant Message receives an unambiguous aborted state.
23. As an authenticated User, I want duplicate delivery of a completed request to replay the stored response, so that a lost network response does not invoke the model twice.
24. As an authenticated User, I want duplicate delivery of a pending, failed, or aborted request rejected predictably, so that retry behavior cannot create a second assistant response for one operation.
25. As an authenticated User, I want a deliberate regeneration to require a new client message UUID, so that it is distinguishable from transport retry.
26. As an authenticated User, I want only one assistant response generated at a time in a Conversation, so that concurrent browser tabs cannot interleave ambiguous Turns.
27. As an authenticated User, I want a stale pending response released after ten minutes when I next send a Message, so that an earlier process crash does not block the Conversation forever.
28. As an authenticated User, I want inaccessible or foreign Conversations to appear nonexistent, so that the API does not disclose another User’s resources.
29. As an authenticated User, I want every Conversation and Message operation scoped by my verified Cognito identity, so that a client-supplied identifier cannot change ownership.
30. As an authenticated User, I want my local application User created automatically on first use, so that the existing Cognito users require no manual database import.
31. As an authenticated User, I want database identifiers represented safely in the API, so that JavaScript number precision cannot corrupt a `bigint` identifier.
32. As an authenticated User, I want an oversized message rejected before model invocation, so that an accidental prompt cannot create uncontrolled cost.
33. As an operator, I want the API to refuse startup when its database credentials, network path, grants, or CA verification are invalid, so that an unhealthy deployment cannot pass startup unnoticed.
34. As an operator, I want PostgreSQL connections pooled with explicit limits and timeouts, so that an ECS task cannot open unbounded RDS connections.
35. As an operator, I want local development to use PostgreSQL 18 with the same migrations and role separation as production, so that schema and permission errors appear before deployment.
36. As an operator, I want one local command to reset only the project’s PostgreSQL data and rerun migrations, so that development state is reproducible.
37. As an operator, I want all schema changes committed as forward-only migrations, so that the repository remains the database source of truth.
38. As an operator, I want concurrent migration tasks serialized by a PostgreSQL advisory lock, so that duplicate deployments cannot execute migrations simultaneously.
39. As an operator, I want the migration task to use DDL credentials unavailable to the API container, so that runtime compromise does not grant schema modification privileges.
40. As an operator, I want migrations to run from the same immutable image as the API, so that deployment does not depend on maintaining a second artifact.
41. As an operator, I want every API deployment to run the migration task first, so that incompatible application code cannot reach the service before its schema.
42. As an operator, I want the pipeline to inspect the migration container exit code, so that merely reaching the ECS `STOPPED` state cannot be mistaken for success.
43. As an operator, I want a failed migration to stop the API rollout, so that the previous service revision remains active.
44. As an operator, I want the migration task to reuse the API service’s private subnets and Security Group, so that network configuration is not duplicated or allowed to drift.
45. As an operator, I want the RDS certificate chain verified, so that encrypted traffic is also protected from an untrusted endpoint.
46. As a developer, I want integration tests against a real PostgreSQL container, so that PostgreSQL constraints, transactions, indexes, grants, and migration behavior are exercised rather than mocked.
47. As a developer, I want unit tests to remain runnable without Docker, so that pure validation and UI feedback stay fast.
48. As a developer, I want database access confined to repositories, so that HTTP handlers cannot bypass ownership or transaction rules with ad hoc SQL.

## Implementation Decisions

- The POC includes User mapping, Conversation creation and listing, Message loading and sending, streaming persistence, ownership, idempotency, keyset pagination, frontend Conversation navigation, local PostgreSQL, migrations, integration tests, and the migration deployment gate.
- Cognito remains the identity source. The API continues to verify the Access Token and now requires a non-empty `sub` claim. It never accepts a client-provided application User identifier.
- A local User contains an identity primary key, unique non-null Cognito subject, and creation timestamp. Cognito profile attributes are not copied into PostgreSQL.
- A Conversation contains an identity primary key, owning User foreign key with cascading deletion, nullable title, creation timestamp, activity timestamp, and nullable soft-deletion timestamp.
- Summary fields are intentionally absent from the initial schema. They will be added by a later forward migration when summary behavior is designed.
- A Message contains an identity primary key, Conversation foreign key with cascading deletion, role, status, content, metadata, globally unique client message UUID when present, optional reply reference, and creation timestamp.
- Database identity columns use generated `bigint` values. API responses encode all database identifiers as strings.
- Message roles are `user`, `assistant`, and `system`. Message statuses are `pending`, `complete`, `error`, and `aborted`.
- User and system Messages must be complete. Assistant Messages may use any defined status. User Messages require a client message UUID and no reply reference; assistant Messages require a unique reply reference to the user Message they answer and no client message UUID.
- The globally unique partial index on client message UUID deliberately supports retry of Conversation creation before a Conversation identifier exists.
- A partial unique index permits at most one pending assistant Message per Conversation. Repository locking remains the normal concurrency mechanism; the index protects against cross-task races.
- Message content is non-null text with an empty-string default. Partial assistant content is retained for error and aborted outcomes.
- Message metadata is non-null JSON with an empty-object default. The POC records only the assistant model name and does not persist raw provider errors or guardrail responses.
- Conversation listing is indexed and ordered by activity timestamp descending and identity descending, excluding soft-deleted rows.
- Message ordering is indexed by Conversation, creation timestamp, and identity.
- The application uses the existing `postgres` database and `public` schema because this RDS instance is dedicated to Chat RAG. Database roles are infrastructure bootstrap and are not created by production migrations.
- The migration role owns application objects and establishes table and sequence privileges for the application role. Local initialization creates equivalent roles for development and tests.
- Database access is split into a pooled client, declarative schema, migration runner, and repositories for Users, Conversations, and Messages. Express handlers do not construct SQL.
- The pool has a maximum of 10 connections, a 30-second idle timeout, and a 5-second connection timeout.
- Production requires TLS with certificate verification and a committed public RDS CA bundle for `eu-central-1`. Local PostgreSQL disables SSL explicitly; production cannot silently downgrade verification.
- The server performs a database `SELECT 1` before listening and exits non-zero on failure. The existing health endpoint remains a lightweight process liveness check.
- User resolution uses an insert-on-conflict flow and returns the existing User without requiring backfill of current Cognito users.
- Every Conversation or Message repository operation enforces ownership in the same SQL statement or transaction. Foreign or soft-deleted resources produce `404`, never `403`.
- Creating a Conversation requires a trimmed message of 1–10,000 characters and a client-generated UUID. The input guardrail runs first; an intervention streams the existing fallback without persistence or model invocation.
- After an accepted first input, a short transaction creates the Conversation, assigns a title from the normalized first 80 characters, inserts the complete user Message, inserts the pending assistant Message, and updates activity time.
- Adding a later Turn first resolves an existing idempotency record. For a new operation, it evaluates the guardrail, locks the owned Conversation, converts pending assistant Messages older than ten minutes to aborted, rejects a newer pending response, loads recent context, and inserts the user and pending assistant Messages in one short transaction.
- No database transaction stays open during an OpenAI request or response stream.
- Model context contains at most the 20 most recent complete persisted Messages in chronological order followed by the current user Message. Pending, error, and aborted assistant Messages are excluded.
- Assistant deltas are buffered in memory while also being sent to the client. Normal completion performs one conditional update from pending to complete. Provider failure performs one conditional update to error, and disconnect or explicit stop performs one conditional update to aborted.
- Terminal status updates affect only a pending Message so that completion, failure, and disconnect races cannot overwrite each other.
- A completed duplicate request returns `200` and replays stored content through SSE without invoking the guardrail or model again. A duplicate pending, error, or aborted request returns `409`. Regeneration uses a new UUID.
- Creating a Conversation with its first Message and appending a later Message are two entry points to one application use case; validation, persistence, provider streaming, and status transitions are not duplicated.
- The old stateless chat endpoint is removed in the coordinated frontend and backend release.
- The API provides create-and-stream Conversation, list Conversations, get one Conversation, list Conversation Messages, and append-and-stream Message operations. Rename and deletion endpoints are deferred.
- Conversation pages default to 20 and allow at most 100 items. They use an opaque cursor containing activity timestamp and identity.
- Message pages initially load the newest 50 and allow at most 100 items. Results are returned chronologically, while the cursor requests an older page.
- SSE uses typed JSON events for Turn start, response delta, response completion, and response failure. The initial Turn event includes Conversation, user Message, and assistant Message identifiers. The old textual done sentinel is removed.
- Errors before SSE headers are ordinary JSON errors with appropriate HTTP status. Errors after streaming starts are terminal typed SSE events.
- The web UI gains a Conversation sidebar, New chat action, active Conversation state, newest-Conversation startup selection, Load more, and Load older messages.
- New chat is local state until the first guarded Message is accepted. The UI creates its selected Conversation from the first Turn-started SSE event.
- Selecting another Conversation or starting a new chat is disabled during streaming. Stop aborts the request and navigation becomes available after the stream settles.
- Completed assistant content is displayed normally. Aborted and error records retain partial content and display a clear terminal-state label.
- Local Compose adds a health-checked PostgreSQL 18.3 service and a project-scoped persistent volume. Local API configuration uses the application role; migration commands use the migration role.
- Database scripts cover generation, migration, and reset. Reset removes only this project’s local PostgreSQL volume, restarts PostgreSQL, waits for readiness, and migrates; it must not accept a production database URL.
- Drizzle migrations are committed and forward-only. The initial migration creates enums, tables, foreign keys, checks, indexes, and grants. Manual production `ALTER TABLE` operations are prohibited.
- The migration runner uses one dedicated PostgreSQL session to acquire a stable advisory lock, run pending migrations, and release the lock. Failure exits non-zero.
- The production image contains compiled API and migration entry points, committed migration SQL, and the RDS CA bundle. Drizzle Kit is build/development tooling; the runtime migration command uses production dependencies.
- The API and migration use separate ECS Task Definitions and separate Secrets Manager values, but the same immutable image. The API receives only `chat-rag/db/app`; the migration task receives only `chat-rag/db/migrate`.
- The two Secrets Manager values are full connection URLs. Passwords are URL-encoded, and neither Task Definition nor workflow contains a plaintext credential.
- GitHub Actions continues to authenticate to AWS through OIDC; no database value is copied to GitHub Secrets.
- Every production API image deployment registers and runs the migration Task Definition first. Network configuration is read from the existing API service and reused for the one-off task.
- The workflow waits for the migration task to stop, then inspects the named essential container’s exit code and ECS stop reason. Only exit code zero permits service deployment.
- The deployment remains single-image and uses the existing ECS circuit breaker for the subsequent API rollout.
- AWS prerequisites are already prepared: the two database secrets, execution-role secret access, GitHub Actions migration permissions, private ECS subnets, disabled public IP, and the API Security Group permitted by RDS.

## Testing Decisions

- Tests assert externally visible behavior and durable database effects rather than Drizzle query construction or private helper calls.
- The primary backend seam is the authenticated HTTP API exercised with the existing Express test approach. Guardrail and model streaming are controlled fakes at their established service boundaries; PostgreSQL is real.
- The primary persistence seam is a PostgreSQL 18 container initialized with the production-equivalent application and migration roles. Repositories and HTTP tests use actual transactions, constraints, indexes, and permissions.
- The migration seam is the migration command as a process: tests assert its exit status and resulting schema rather than calling internal migration functions directly.
- The frontend seam is the rendered chat page with mocked HTTP/SSE transport, extending the existing Vitest and DOM-testing style.
- Unit tests remain responsible for request validation, cursor encoding/decoding, SSE parsing, authentication claim validation, and small frontend state transitions that do not require PostgreSQL.
- Integration tests cover first-use User creation and repeated resolution of the same Cognito subject.
- Integration tests cover complete isolation between two Users for Conversation lookup, listing, Message listing, and Message send.
- Integration tests verify inaccessible, foreign, soft-deleted, and nonexistent Conversations all return `404` without distinguishing the cause.
- Integration tests cover atomic creation of Conversation, user Message, and pending assistant Message.
- Integration tests verify guardrail intervention creates no User Turn or empty Conversation and never invokes the model.
- Integration tests cover Conversation ordering, deterministic title generation, string identifiers, default page size, maximum limit, and stable keyset pagination when timestamps tie.
- Integration tests cover Message chronological ordering, loading the newest page, loading older pages, and no duplicate or missing records across cursors.
- Integration tests cover the 10,000-character boundary and rejection of empty or oversized input before persistence and model invocation.
- Integration tests cover successful streaming to complete, disconnect and explicit stop to aborted, provider failure to error, and persistence of partial buffered content.
- Integration tests verify only complete Messages enter model context, context is capped at 20, and current input follows persisted context.
- Integration tests cover completed-request replay without a second model call and `409` results for duplicate pending, error, or aborted operations.
- Integration tests cover idempotent first-Conversation retry using the global client message UUID.
- Integration tests send concurrent requests to one Conversation and verify exactly one pending assistant Message and one `409` response.
- Integration tests create stale and fresh pending responses to verify opportunistic abortion after ten minutes and rejection before that threshold.
- Integration tests verify status updates are conditional and terminal states cannot overwrite one another during close/completion races.
- Migration tests run against an empty database, rerun as a no-op, and run two migration processes concurrently to exercise the advisory lock.
- Migration tests verify the application role can select, insert, update, and delete application data and use identity sequences after migration, but cannot perform DDL.
- Migration tests introduce a deliberately broken test migration and assert a non-zero process exit. Data-preservation tests are deferred until a later migration transforms existing schema or data.
- Startup tests verify the server refuses to listen when the database is unreachable or TLS configuration is invalid, while normal health behavior remains lightweight after startup.
- Frontend tests cover automatic newest-Conversation selection, empty state, New chat, initial Turn ID adoption, Conversation switching, pagination controls, progressive deltas, completed state, aborted/error labels, authentication failure, and navigation locking during a stream.
- Workflow-supporting logic for running and inspecting an ECS migration task should live in a testable command or script rather than only opaque inline shell. Tests verify that missing task/container data or a non-zero exit code fails the command.
- CI runs unit suites without external services and a separate sequential integration suite with a PostgreSQL service container. The same committed migrations initialize local, CI, and AWS databases.

## Out of Scope

- Conversation summary generation and the summary-related database columns.
- A separate Conversation summaries table.
- RAG, document ingestion, embeddings, vector search, and `pgvector`.
- Output guardrails; the accepted input guardrail remains unchanged.
- Conversation rename, soft-delete API, hard deletion of User data, and scheduled deletion of old soft-deleted Conversations.
- A scheduled cleanup task for pending Messages; the POC performs opportunistic stale cleanup on the next send.
- RDS Proxy, Aurora, read replicas, Redis, DynamoDB, Multi-AZ changes, ECS autoscaling, or other infrastructure expansion.
- Backfilling the three existing Cognito users before they first use persistence.
- Importing historical stateless chats, because they were never stored.
- URL routing or deep links for individual Conversations.
- Infinite scrolling, Conversation search, folders, sharing, collaboration, branching, or message editing.
- Unlimited full-history model context or token-aware summarization.
- A second Docker image for migrations.
- Rollback migrations or manual production schema changes.
- Infrastructure as Code for the already completed Secrets Manager and IAM bootstrap.

## Further Notes

- The repository glossary defines User, Conversation, Message, and Turn; implementation and tests should use these terms consistently.
- The accepted ADRs require one shared streaming use case for Conversation writes and a blocking migration task before API deployment.
- The existing deployment workflow already builds an immutable commit-tagged image, registers the API Task Definition, waits for service stability, and verifies production health. The migration gate extends this flow rather than replacing it.
- The existing ECS service uses two private subnets, the API Security Group, and disabled public IP assignment. The workflow must obtain these values dynamically from the service.
- The RDS instance is PostgreSQL 18.3 in `eu-central-1`, reachable privately from the API Security Group on port 5432.
- The production roles `chat_rag_migrate` and `chat_rag_app` already exist with default privileges configured for objects created by the migration role.
- AWS prerequisites were completed before implementation: `chat-rag/db/app`, `chat-rag/db/migrate`, execution-role access to both secrets, and GitHub Actions permissions for the one-off migration task.
