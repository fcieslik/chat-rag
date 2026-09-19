# 03: GitHub Actions Guardrail evaluation gate

**What to build:** Every existing branch push runs the live Guardrail evaluation suite through the repository's existing OIDC identity. An unexpected Guardrail Result or AWS failure blocks CI, making managed Bedrock behavior changes visible for review before deployment.

**Blocked by:** 02: Local deterministic Guardrail evals; external prerequisite: the maintainer grants `bedrock:ApplyGuardrail` for the configured guardrail to `chat-rag-github-actions`.

**Status:** ready-for-agent

- [ ] GitHub Actions runs a separate blocking Guardrail-evaluation job on the workflow's current branch-push triggers and authenticates through the existing OIDC role.
- [ ] The job supplies only non-secret guardrail configuration and fails when AWS credentials, the service call, or an expected result are unavailable or incorrect.
- [ ] Documentation states the least-privilege IAM prerequisite, local SSO workflow, CI execution behavior, and the requirement to review and commit intentional baseline changes.
- [ ] The workflow preserves the existing validation and deployment behavior outside the new evaluation gate.
