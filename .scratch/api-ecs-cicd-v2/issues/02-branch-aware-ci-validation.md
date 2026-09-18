# 02: Branch-aware CI validation

**What to build:** Add a validation job to the existing GitHub Actions workflow for `feature/**` and `main`, using only the repository's existing package scripts. The validation job must have no AWS deployment permissions and must gate the production job on `main`.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A push to a `feature/**` branch runs `pnpm test`, `pnpm typecheck:api`, `pnpm typecheck:web`, `pnpm build:api`, and `pnpm build:web`.
- [ ] A push to `main` runs the same validation commands before any production build or deployment step.
- [ ] On `main`, frontend-only, tests-only, and other non-API changes run validation only; production deployment runs only when API source or deployment-relevant files change.
- [ ] Feature-branch validation does not request AWS OIDC credentials, log in to ECR, push an image, register a Task Definition, or update ECS.
- [ ] The validation job has only `contents: read`; `id-token: write` exists only on the `main` deployment job.
- [ ] A validation failure prevents the production build and deployment jobs from starting.
- [ ] Changes consisting only of `docs/agents/**`, `.scratch/**`, `AGENTS.md`, or `CLAUDE.md` do not start the production deployment workflow.
- [ ] A mixed change containing an excluded documentation file and an API or deployment-relevant file is not skipped.
- [ ] The workflow triggers on `main` and `feature/**` push events and passes static YAML and action-input validation.
