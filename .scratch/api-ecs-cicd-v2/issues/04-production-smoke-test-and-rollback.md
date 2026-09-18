# 04: Production smoke test and rollback verification

**What to build:** Complete the production deployment pipeline with an end-to-end health check through API Gateway and document how an unhealthy ECS deployment is reported as failed and rolled back by the configured circuit breaker.

**Blocked by:** 03: Automated production image and ECS rollout.

**Status:** ready-for-agent

- [ ] The smoke test runs only after ECS reports the new service deployment as stable.
- [ ] The smoke test calls the public API Gateway `GET /prod/health` endpoint.
- [ ] The smoke test requires a successful HTTP response.
- [ ] The smoke test verifies the existing `{"status":"ok"}` response.
- [ ] The deployment pipeline does not call the authenticated `/v1/chat` endpoint.
- [ ] A failed smoke test fails the GitHub Actions job and is visible as a failed production deployment.
- [ ] A controlled ECS deployment failure, separate from the post-stability smoke test, confirms that ECS's circuit breaker marks the deployment failed and rolls the service back to the last completed deployment.
- [ ] The failed commit-SHA image and Task Definition revision remain identifiable for diagnosis and rollback.
- [ ] A successful deployment confirms the new Task Definition revision, ECS service health, ALB health, CloudWatch logs, and API Gateway health response.
- [ ] The documentation states that a post-stability smoke-test failure fails GitHub Actions but does not itself activate the ECS deployment circuit breaker.
