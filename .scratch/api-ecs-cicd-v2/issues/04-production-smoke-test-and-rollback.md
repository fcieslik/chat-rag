# 04: Production smoke test and rollback verification

**What to build:** Complete the production deployment pipeline with an end-to-end health check through API Gateway and document how an unhealthy ECS deployment is reported as failed and rolled back by the configured circuit breaker.

**Blocked by:** 03: Automated production image and ECS rollout.

**Status:** resolved

- [x] The smoke test runs only after ECS reports the new service deployment as stable.
- [x] The smoke test calls the public API Gateway `GET /prod/health` endpoint.
- [x] The smoke test requires a successful HTTP response.
- [x] The smoke test verifies the existing `{"status":"ok"}` response.
- [x] The deployment pipeline does not call the authenticated `/v1/chat` endpoint.
- [x] A failed smoke test fails the GitHub Actions job and is visible as a failed production deployment.
- [x] The circuit-breaker rollback procedure is documented as a separate controlled operator test; intentionally breaking production is not part of the normal release verification.
- [x] The failed commit-SHA image and Task Definition revision remain identifiable for diagnosis and rollback.
- [x] A successful deployment confirms the new Task Definition revision, ECS service health, ALB health, CloudWatch logs, and API Gateway health response; ALB and CloudWatch confirmation remain manual operator checks.
- [x] The documentation states that a post-stability smoke-test failure fails GitHub Actions but does not itself activate the ECS deployment circuit breaker.

## Resolution

The live deployment for commit `7c95fa5e3316f7c4e77a158dc513bf3525328a86` passed validation, ECS deployment, stability verification, and the API Gateway `/prod/health` smoke test in [GitHub Actions run 35328463437](https://github.com/fcieslik/chat-rag/actions/runs/35328463437). The ticket is resolved without adding ELBv2 or CloudWatch Logs permissions to the GitHub Actions role.
