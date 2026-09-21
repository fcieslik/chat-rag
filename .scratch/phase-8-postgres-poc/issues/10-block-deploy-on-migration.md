# 10: Block ECS rollout until migrations succeed

**What to build:** Extend the production deployment so every backend image runs its committed migrations in the private ECS network before the API service receives that image, and a stopped but unsuccessful task cannot be mistaken for a valid migration.

**Blocked by:** 09: Prepare the image for verified RDS access and migrations.

**Status:** ready-for-agent

- [ ] The deployment renders and registers API and migration Task Definitions with the same commit-tagged image.
- [ ] The migration task obtains the current API service’s subnets, Security Group, and disabled-public-IP setting dynamically.
- [ ] The workflow runs exactly one migration task in the existing cluster and waits for it to stop.
- [ ] Deployment verifies that the expected essential migration container exists and has exit code zero.
- [ ] Missing task data, missing container data, ECS launch failure, non-zero exit code, or an abnormal stop reason fails the job before service deployment.
- [ ] Successful migration continues through the existing service update, stability wait, deployment identity summary, and public health verification.
- [ ] The migration inspection logic is a testable command rather than untested inline parsing.
- [ ] Tests demonstrate success, non-zero exit, missing container, and task launch failure behavior without invoking a production deployment.
- [ ] Workflow validation includes a PostgreSQL service for integration tests while preserving unit-only test execution outside the integration job.
