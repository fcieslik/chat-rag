# 01: AWS deployment prerequisites and Task Definition baseline

**What to build:** Record the completed AWS CI/CD pre-flight and make the confirmed production resources the fixed inputs for the GitHub Actions implementation. The workflow must consume the existing configuration and must not repeat or replace the AWS setup.

**Blocked by:** None (can start immediately).

**Status:** resolved

**Resolution:** AWS pre-flight was completed for the current production deployment. No additional IAM role, OIDC trust-policy change, ECS service change, ALB change, or AWS resource creation is required for the workflow implementation.

- [x] Region is `eu-central-1` and account is `385740679214`.
- [x] ECS cluster is `chat-rag-cluster`; service is `chat-rag-api-service`; Task Definition family is `chat-rag-api`.
- [x] Active production revision is `chat-rag-api:8`; desired count is `1`; running count is `1`.
- [x] ECS uses `awsvpc`, public IP is disabled, deployment controller is `ECS`, and strategy is rolling with minimum healthy `100%` and maximum `200%`.
- [x] ECS deployment circuit breaker and automatic rollback are enabled.
- [x] Target group is `chat-rag-internal-tg`, attached to container `chat-rag-api` port `8000`, with HTTP `GET /health` on `traffic-port` and expected status `200`.
- [x] `infra/ecs/task-definition.json` is tracked in Git and is based on the working revision; differences from AWS are limited to ECS-generated fields and JSON formatting.
- [x] The Task Definition keeps the Secrets Manager `valueFrom` reference and does not contain a secret value.
- [x] The existing `chat-rag-github-actions` role has the required ECR permissions plus `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, `ecs:DescribeServices`, and `iam:PassRole` restricted to the two API task roles.
- [x] The GitHub OIDC trust policy is restricted to `fcieslik/chat-rag`, branch `main`, with audience `sts.amazonaws.com`.

**Implementation constraint:** Later tickets must use these existing AWS identifiers and must not add AWS setup steps to the workflow.
