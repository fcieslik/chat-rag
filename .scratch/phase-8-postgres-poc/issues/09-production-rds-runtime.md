# 09: Prepare the image for verified RDS access and migrations

**What to build:** Produce one immutable backend image that can either start the API with least-privilege application credentials or run migrations with separate DDL credentials, while refusing insecure or unusable production database configuration.

**Blocked by:** 02: Run local PostgreSQL and role-separated migrations.

**Status:** ready-for-agent

- [ ] The production pool uses a maximum of 10 connections, 30-second idle timeout, and 5-second connection timeout.
- [ ] Production requires TLS with certificate verification and the public `eu-central-1` RDS CA bundle included in the image.
- [ ] Local and test environments disable SSL explicitly without permitting a production fallback to unverified TLS.
- [ ] The server executes a database readiness query before listening and exits non-zero when credentials, grants, connectivity, or TLS verification fail.
- [ ] Graceful process shutdown closes the database pool.
- [ ] The image includes compiled API and migration entry points, committed migration assets, and the CA bundle while continuing to run as the non-root user.
- [ ] The API Task Definition receives only the application connection secret.
- [ ] A separate migration Task Definition uses the same image, receives only the migration connection secret, and runs the migration command without exposing an HTTP port.
- [ ] No plaintext database URL or password appears in image metadata, Task Definitions, workflow configuration, or logs.
- [ ] Tests cover configuration validation and startup refusal; the built image is smoke-tested for both API and migration commands.
