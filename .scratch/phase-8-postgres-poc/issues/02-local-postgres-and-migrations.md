# 02: Run local PostgreSQL and role-separated migrations

**What to build:** Give developers a reproducible PostgreSQL 18.3 environment whose schema, migration credentials, application credentials, and forward-only migration behavior match production closely enough to expose permission and concurrency errors before deployment.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Local Compose starts a health-checked PostgreSQL 18.3 service with a project-scoped persistent volume.
- [ ] Local initialization creates separate `chat_rag_migrate` and `chat_rag_app` login roles and a separate test database without embedding production credentials.
- [ ] The API workspace includes `pg`, Drizzle ORM, Drizzle Kit, type support, schema configuration, and database commands using the existing package manager.
- [ ] The initial forward-only migration creates User, Conversation, and Message storage with the accepted identity columns, enums, timestamps, foreign keys, checks, partial unique indexes, ordering indexes, JSON metadata defaults, soft-deletion field, and reply relationship.
- [ ] Summary columns are absent from the initial schema.
- [ ] The migration grants the application role DML and sequence access without granting DDL privileges.
- [ ] The migration runner holds a stable PostgreSQL advisory lock on one session and exits non-zero on failure.
- [ ] `db:reset` refuses a production-looking database target, removes only this project’s local database volume, waits for readiness, and runs migrations as the migration role.
- [ ] Tests cover migration of an empty database, a second no-op run, two concurrent runners, advisory-lock serialization, application-role access, denied application-role DDL, and a deliberately failed migration process.
- [ ] Unit tests remain runnable without requiring the PostgreSQL container.
