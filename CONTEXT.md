# Chat RAG deployment context

This context describes the production deployment boundary for the Chat RAG API.

## Deployment language

**Task Definition**:
The versioned ECS configuration that describes how the API container runs, including its image reference, runtime settings, logging, roles, and secret references.
_Avoid_: ECS task, container definition (when referring to the complete configuration)

**ECS service**:
The long-running production workload that keeps the API tasks running and replaces them during a rolling deployment.
_Avoid_: task definition (the service uses a task definition; it is not one)

**Production deployment**:
The promotion of a commit from `main` into the existing ECS service after its image has been published to ECR.
_Avoid_: manual ECS update

**Deployment circuit breaker**:
The ECS failure mechanism that marks an unhealthy rolling deployment as failed and can restore the last completed deployment.
_Avoid_: pipeline rollback (the rollback is performed by ECS)
