# 03: Automated production image and ECS rollout

**What to build:** After successful validation on `main`, build and publish the API image with an immutable commit-SHA tag, render that image into the committed `infra/ecs/task-definition.json`, register a new ECS revision, update the existing production ECS service, wait for service stability, and document both automatic and manual deployment paths.

**Blocked by:** 02: Branch-aware CI validation.

**Status:** ready-for-agent

- [ ] A successful `main` validation builds the API Docker image from the current commit.
- [ ] The image is pushed to the existing `chat-rag-api` ECR repository with the current commit SHA as its tag.
- [ ] The workflow uses the existing GitHub OIDC role and does not use long-lived AWS access keys.
- [ ] The workflow loads `infra/ecs/task-definition.json` and replaces only the API container image in that Task Definition.
- [ ] Existing runtime configuration and Secrets Manager references are preserved in the rendered Task Definition.
- [ ] The workflow registers a new ECS Task Definition revision.
- [ ] The workflow updates `chat-rag-api-service` in `chat-rag-cluster` to that revision.
- [ ] The workflow waits for ECS service stability and fails if the deployment does not stabilize.
- [ ] A successful release requires no manual Task Definition revision or ECS service update in the AWS Console.
- [ ] A failed build, image push, Task Definition registration, or ECS update fails the workflow.
- [ ] `README.md` documents the automatic `main` deployment while retaining the existing manual ECS deployment procedure as a fallback.
- [ ] The workflow uses the confirmed cluster, service, repository, region, container name, and Task Definition path without changing AWS configuration.
