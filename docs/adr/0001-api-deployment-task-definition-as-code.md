---
status: accepted
---

# API deployment uses Task Definition as code

The API production deployment will keep the working ECS Task Definition in `infra/ecs/task-definition.json`, replace only its container image with the immutable commit-tagged ECR image, and let GitHub Actions register the revision and update the existing ECS service. AWS OIDC and a least-privilege IAM role remain the deployment boundary; ECS rolling deployment with a deployment circuit breaker and rollback protects the service. This keeps the runtime configuration reviewable in Git while preserving the existing Secrets Manager references and avoiding a staging environment until one is needed.
