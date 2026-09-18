Status: ready-for-agent

# Automated ECS deployment for the API

## Problem Statement

The API deployment is only partially automated. A push to `main` currently builds the Docker image and pushes it to ECR, but someone must manually create or select a new ECS Task Definition revision and update the ECS service. This is slow, easy to perform inconsistently, and leaves the production deployment state outside the repository.

## Solution

Extend the GitHub Actions workflow into a complete production deployment pipeline. Changes on feature branches run the existing test and build validation and stop before AWS. A change pushed to `main` must pass validation, build and publish an immutable API image tagged with the commit SHA, render that image into the versioned ECS Task Definition, register the new Task Definition revision, update the existing ECS service, wait for ECS to become stable, and verify the public API path with `GET /prod/health`.

The existing production resources remain in place: the `chat-rag-api` ECR repository, `chat-rag-cluster` ECS cluster, `chat-rag-api-service` ECS service, internal ALB, VPC Link, API Gateway, CloudWatch log group, and Secrets Manager configuration.

## User Stories

1. As a developer, I want a push to a feature branch to run automated validation, so that integration problems are found before merging.
2. As a developer, I want feature-branch validation to stop before AWS deployment, so that unfinished work cannot change production.
3. As an application owner, I want a push to `main` to run the same validation before deployment, so that production receives only tested changes.
4. As an application owner, I want documentation-only agent changes to avoid the API deployment workflow, so that pipeline time is not wasted on changes that cannot affect the API image.
5. As an application owner, I want a successful `main` validation to build the API Docker image, so that the artifact matches the source commit.
6. As an application owner, I want the image pushed to the existing `chat-rag-api` ECR repository, so that the current ECS service remains the deployment target.
7. As an application owner, I want every image tagged with the Git commit SHA, so that each deployment has an immutable and identifiable artifact.
8. As an application owner, I want the workflow to use GitHub OIDC instead of long-lived AWS access keys, so that AWS access is short-lived and tied to the workflow identity.
9. As an application owner, I want the workflow to assume the existing `chat-rag-github-actions` role, so that deployment uses one controlled AWS access boundary.
10. As an application owner, I want the GitHub OIDC trust policy restricted to this repository and `main`, so that another repository or branch cannot deploy to production.
11. As an application owner, I want the confirmed working ECS Task Definition configuration versioned in Git, so that the production runtime configuration is reviewable and reproducible.
12. As an application owner, I want the workflow to preserve the current CPU, memory, network, port, logging, environment, role, and runtime settings, so that automation does not silently change the service configuration.
13. As an application owner, I want the workflow to preserve existing Secrets Manager `valueFrom` references, so that secrets continue to be loaded by ECS without exposing their values to GitHub Actions or Git.
14. As an application owner, I want the workflow to change only the API container image for a normal application deployment, so that unrelated runtime configuration is not rewritten on every release.
15. As an application owner, I want the workflow to render the ECR image tagged with the current commit into the Task Definition, so that ECS launches the artifact produced by the same workflow run.
16. As an application owner, I want the workflow to register a new ECS Task Definition revision, so that every production deployment has an auditable ECS revision.
17. As an application owner, I want the workflow to update `chat-rag-api-service` in `chat-rag-cluster`, so that ECS automatically replaces the running task without manual console work.
18. As an application owner, I want ECS to use a rolling deployment, so that the service can replace old tasks with new tasks using the existing service strategy.
19. As an application owner, I want the ECS deployment circuit breaker enabled, so that a deployment that cannot become healthy is marked as failed.
20. As an application owner, I want ECS to roll back a failed deployment to the last completed deployment, so that a broken image does not remain active in production.
21. As an application owner, I want GitHub Actions to wait for ECS service stability, so that a successful AWS update request is not mistaken for a successful deployment.
22. As an application owner, I want the pipeline to fail if ECS cannot reach a stable state, so that the failed release is visible in GitHub Actions.
23. As an application owner, I want ECS and ALB health checks to validate `/health`, so that a running container must also be reachable through the service's health boundary.
24. As an application owner, I want the pipeline to call the public API Gateway `/prod/health` endpoint after ECS stabilizes, so that the complete API Gateway → VPC Link → internal ALB → ECS path is verified.
25. As an application owner, I want the smoke test to expect HTTP success and the existing `{"status":"ok"}` response, so that a broken routing or application response fails the deployment job.
26. As an application owner, I do not want the deployment pipeline to call `/v1/chat`, so that Cognito token lifecycle management is not introduced into deployment verification.
27. As an application owner, I want the deployment role to have only the ECR permissions already required plus the minimum ECS registration and service update permissions, so that a compromised workflow has a limited blast radius.
28. As an application owner, I want `iam:PassRole` restricted to the exact ECS task execution and task roles, so that GitHub Actions cannot pass arbitrary IAM roles.
29. As an application owner, I want the existing ECS task execution role to retain responsibility for Secrets Manager and log access, so that the GitHub deployment role does not receive secret access.
30. As an application owner, I want a failed deployment to retain its immutable image and Task Definition revision, so that the failed release can be diagnosed and the previous revision can be identified.
31. As an application owner, I want a successful deployment to require no manual ECS Task Definition or service update, so that `git push` is the complete release trigger.
32. As an application owner, I want the current production environment to remain the only environment, so that the first CI/CD implementation does not add staging infrastructure.
33. As a maintainer, I want the workflow to keep the existing exclusion for `docs/agents/**`, `.scratch/**`, `AGENTS.md`, and `CLAUDE.md`, so that agent-process changes do not build or deploy the API image.
34. As a maintainer, I want mixed commits containing both excluded documentation and API changes to deploy normally, so that path filtering cannot hide a real application change.
35. As a maintainer, I want deployment configuration changes to be reviewed as normal repository changes, so that changes to the production runtime are visible before they reach ECS.
36. As a maintainer, I want the README to retain the manual ECS deployment procedure while documenting the automatic GitHub Actions path, so that the fallback remains available during diagnosis or recovery.

## Implementation Decisions

- Use the existing GitHub Actions workflow as the CI/CD boundary. No application runtime module or API contract changes are needed.
- Run validation for feature branches without AWS credentials, ECR push, ECS registration, or ECS service updates.
- Make the `main` production job depend on successful validation before it performs any AWS deployment action.
- Keep `main` as the only production deployment branch. Do not create a staging branch or staging AWS resources.
- Continue excluding `docs/agents/**`, `.scratch/**`, `AGENTS.md`, and `CLAUDE.md` from the production workflow. A commit containing any non-excluded application change must still run the workflow.
- Keep the existing ECR repository, AWS region, account, cluster, service, and OIDC role.
- Use the already confirmed and versioned Task Definition document at `infra/ecs/task-definition.json` as the workflow input. Do not repeat AWS pre-flight or modify the active AWS configuration as part of the workflow implementation.
- Preserve container settings, task roles, logging, port mappings, environment values, and Secrets Manager `valueFrom` references.
- Use the official ECS render action to replace the API container image with the current ECR image tagged by `github.sha`.
- Use the official ECS deploy action to register the rendered Task Definition, update the existing ECS service, and wait for service stability.
- Use the existing ECS service's rolling deployment controller. Enable its deployment circuit breaker and automatic rollback on failure as a one-time AWS service configuration change.
- Treat the ECS service and its ALB health check as the first health boundary. The health check must validate `GET /health` on the API container's existing port.
- Treat the API Gateway `GET /prod/health` request as the second health boundary. The smoke test must run only after ECS reports stability and must fail on a non-success response or unexpected body.
- Preserve the current Secrets Manager integration. GitHub Actions must not read, print, or receive secret values.
- Extend the existing deployment role with `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, and `ecs:DescribeServices`, scoped to the production service where supported.
- Grant `iam:PassRole` only for the exact task execution role and task role referenced by the exported Task Definition. Keep `ecs:RegisterTaskDefinition` scoped as required by AWS for that API.
- Keep the existing ECR permissions needed to authenticate, upload image layers, and publish the image.
- Restrict the OIDC trust policy to the repository and `main` using the subject-claim format currently used by the repository's GitHub OIDC provider configuration.
- Use the commit SHA as the image identity rather than `latest`, so a previous image and Task Definition revision can be selected for rollback.
- Keep the existing manual deployment instructions in `README.md` and append the automatic GitHub Actions procedure.
- Do not introduce Terraform, CDK, CloudFormation, CodeDeploy blue/green deployments, new AWS services, or frontend deployment as part of this feature.

## Testing Decisions

- Test the workflow at its highest useful seam: the GitHub Actions job graph and its externally visible effects, rather than testing action internals.
- Validate the workflow YAML and action inputs statically before merging.
- Run the repository's existing API and web test commands during validation.
- Run the repository's existing type checks during validation where they are part of the current project checks.
- Verify that feature-branch events execute validation but do not execute AWS credential configuration, ECR login, image push, Task Definition registration, or ECS service update.
- Verify that `main` events execute validation before the build and deployment jobs.
- Verify that excluded-only changes do not start the production deployment job.
- Verify that a mixed commit containing an excluded file and an API source change is not skipped.
- Verify that the image tag passed to the Task Definition renderer equals the current commit SHA.
- Verify that the rendered Task Definition preserves the existing container configuration and Secrets Manager references while changing only the image reference.
- Verify that the ECS deploy action receives the rendered Task Definition, the expected cluster, and the expected service.
- Verify that the workflow waits for service stability and fails when the deployment cannot stabilize.
- Verify that the smoke test calls the API Gateway production health endpoint and checks both the HTTP result and expected response body.
- Verify the AWS role policy with IAM policy simulation or an equivalent least-privilege review, including `iam:PassRole` resource restrictions.
- Perform one controlled deployment with a known-good image and confirm the new Task Definition revision, ECS service deployment, CloudWatch logs, ALB health, and API Gateway health response.
- Perform a controlled failure test only in a safe maintenance window or with a deliberately invalid image reference, and confirm ECS circuit-breaker rollback and a failed GitHub Actions job.
- Treat a post-stability API Gateway smoke-test failure as a failed workflow signal; it does not itself activate the ECS circuit breaker.
- Confirm that a previous commit SHA image remains available in ECR long enough to support rollback.

## Out of Scope

- Creating a staging environment or additional ECS services.
- Rebuilding the existing VPC, private subnets, NAT, internal ALB, VPC Link, API Gateway, ECR repository, CloudWatch log group, or Secrets Manager secret.
- Moving infrastructure management to Terraform, CDK, CloudFormation, or another IaC system.
- Changing the API, chat streaming contract, Cognito authentication, authorization behavior, or application code.
- Deploying the web application to S3 or CloudFront.
- Calling the authenticated chat endpoint as part of deployment verification.
- Adding database migrations, background jobs, blue/green deployments, CodeDeploy, canary releases, or CloudWatch alarm-based deployment gates.
- Changing task CPU, memory, desired count, network mode, port, logging, environment configuration, or secret references unless required to preserve the currently working exported Task Definition.
- Giving GitHub Actions permission to read Secrets Manager values.
- Replacing the existing OIDC role with long-lived AWS access keys or a second authentication mechanism.

## Further Notes

- The repository contains `infra/ecs/task-definition.json` as the intended Task Definition source of truth. It must be committed and compared with the active `chat-rag-api` revision before implementation; a read-only ECS export is required only to reconcile any mismatch, not to recreate the file from memory.
- The current deployment workflow already authenticates to AWS through OIDC and publishes the API image to ECR. The missing boundary is Task Definition registration plus ECS service deployment.
- The current API Gateway health URL is documented as `https://2780017ujg.execute-api.eu-central-1.amazonaws.com/prod/health` and is intentionally used instead of `/v1/chat` for deployment smoke testing.
- ECS service circuit-breaker configuration is stored on the ECS service, not in the Task Definition document. It must be configured once in AWS and then preserved by future service updates.
- The deployment role's exact task execution and task role ARNs are present in the repository artifact but must be confirmed against the active Task Definition before writing the final IAM policy.
