# Chat RAG deployment context

This context describes the production deployment boundary for the Chat RAG API.

## Deployment language

**Input guardrail**:
A Bedrock safety policy evaluated against a chat message before the message is sent to the language model.
_Avoid_: prompt filter, moderation check

**Guardrail intervention**:
The decision that an input guardrail has blocked a chat message.
_Avoid_: model refusal, validation error

**Guardrail evaluation**:
A repeatable check of a versioned guardrail policy against a dataset of inputs and explicit expected detections.
_Avoid_: model evaluation, prompt test

**Guardrail result**:
The application-owned, structured record of a guardrail evaluation, containing its action, detected policy signals, and latency.
_Avoid_: AWS SDK response, raw assessment

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

## Conversation language

**User**:
A person authenticated by Cognito whose conversations are isolated from every other user.
_Avoid_: account, database user

**Conversation**:
A user-owned chat thread containing an ordered history of messages.
_Avoid_: session, chat session

**Message**:
A single user, assistant, or system contribution belonging to one conversation.
_Avoid_: prompt (unless referring specifically to model input)

**Turn**:
A user message together with the assistant response created for it.
_Avoid_: request, exchange
