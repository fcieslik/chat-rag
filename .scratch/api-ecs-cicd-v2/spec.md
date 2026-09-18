Status: ready-for-agent

# Automated ECS deployment for the API

## Problem Statement

The API deployment currently builds and pushes an image to ECR, but someone must manually create or select an ECS Task Definition revision and update the ECS service.

## Completed prerequisite

Ticket 01 from the previous package is complete as an AWS CI/CD pre-flight. The confirmed production inputs are:

- Region: `eu-central-1`
- Account: `385740679214`
- ECS cluster: `chat-rag-cluster`
- ECS service: `chat-rag-api-service`
- Task Definition family and active revision: `chat-rag-api:8`
- Desired/running count: `1` / `1`
- Network mode: `awsvpc`; public IP disabled
- Deployment controller: ECS rolling; minimum healthy `100%`; maximum `200%`
- Deployment circuit breaker and rollback: enabled
- Target group: `chat-rag-internal-tg`, container `chat-rag-api`, port `8000`, health check `GET /health`, expected status `200`
- GitHub role: `chat-rag-github-actions`
- OIDC trust: repository `fcieslik/chat-rag`, branch `main`, audience `sts.amazonaws.com`
- IAM deployment permissions: ECR permissions plus `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, `ecs:DescribeServices`, and `iam:PassRole` restricted to the API task roles

No additional AWS setup is required. The workflow must consume these resources and must not modify AWS configuration as part of this package.

## Solution

Feature branch pushes run repository validation and stop before AWS. A push to `main` must pass the same validation. Frontend-only, tests-only, and other non-API changes stop after validation; only changes to API source or deployment-relevant inputs build and publish an immutable API image tagged with the commit SHA, render that image into `infra/ecs/task-definition.json`, register a new Task Definition revision, update the existing ECS service, wait for stability, and verify `GET /prod/health`.

The Task Definition remains the source of truth in Git. The workflow changes only the API container image; Secrets Manager `valueFrom` references and all other runtime settings remain unchanged.

## Scope

- Feature branches: tests, type checks, and builds only; no OIDC, ECR, or ECS access.
- `main`: validation for every workflow-triggering change; Docker build, ECR push, Task Definition render/register, ECS update, stability wait, and API Gateway smoke test only when API source or deployment-relevant inputs change.
- Excluded-only changes: `docs/agents/**`, `.scratch/**`, `AGENTS.md`, and `CLAUDE.md` do not start the workflow.
- Mixed changes containing application or deployment files are not skipped.
- Existing manual ECS deployment instructions in `README.md` remain available as a fallback; automatic deployment documentation is appended.

## Implementation Decisions

- Use the existing `.github/workflows/deploy-api.yml` as the CI/CD boundary.
- Use existing scripts: `pnpm test`, `pnpm typecheck:api`, `pnpm typecheck:web`, `pnpm build:api`, and `pnpm build:web`.
- Give only the deployment job `id-token: write`; validation has only `contents: read`.
- Detect API deployment changes from `apps/api/**`, `infra/**`, the API workflow, and the root package manifests/lockfile; frontend-only, tests-only, and other non-API changes must leave the deployment job skipped after validation.
- Keep `main` as the only production deployment branch and do not create staging infrastructure.
- Use `aws-actions/amazon-ecs-render-task-definition` to replace only the `chat-rag-api` image.
- Use `aws-actions/amazon-ecs-deploy-task-definition` with `wait-for-service-stability: true`.
- Preserve OIDC, IAM roles, Secrets Manager, ECR, ECS, ALB, VPC Link, API Gateway, and CloudWatch configuration.
- Do not introduce Terraform, new AWS services, long-lived AWS keys, or application changes.

## Testing Decisions

- Validate workflow YAML and action inputs statically.
- Verify feature branches never configure AWS, log in to ECR, push images, register Task Definitions, or update ECS.
- Verify `main` deployment depends on successful validation.
- Verify frontend-only, tests-only, and other non-API `main` changes run validation without starting production deployment, while API or deployment-relevant changes start it.
- Verify the rendered Task Definition changes only `image` and preserves `valueFrom`.
- Verify ECS deployment receives the confirmed cluster, service, and Task Definition.
- Verify the smoke test runs after ECS stability and expects HTTP success plus `{"status":"ok"}`.
- A post-stability smoke-test failure fails GitHub Actions but does not activate the ECS circuit breaker.
- A controlled unhealthy ECS deployment may be tested separately in a safe maintenance window to confirm circuit-breaker rollback.

## Out of Scope

- New staging environments or AWS services.
- Changes to application behavior, Cognito, networking, ALB, API Gateway, Secrets Manager, or ECS runtime settings.
- Terraform/CDK/CloudFormation, CodeDeploy, blue/green or canary deployments.
- Calling authenticated `/v1/chat` from the deployment workflow.
