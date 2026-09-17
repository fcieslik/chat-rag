# AWS Chat RAG — Architecture & Learning Roadmap

## 1. Project Goal

Build a production-like **AI Chat + RAG application on AWS**, while learning the underlying AWS architecture by creating the infrastructure manually through the **AWS Console**.

The project will intentionally use enterprise-style architecture even when some components are initially more complex than strictly necessary.

The main principle:

> **Learn the infrastructure first, then automate it later with IaC.**

The first version will contain only an anonymous AI chat. RAG, authentication, conversation persistence, and agents will be added incrementally.

---

# 2. Technology Stack

## Frontend

- React
- Vite
- TypeScript
- Vercel AI SDK
- AG UI — planned for the agentic stage
- Amazon S3
- Amazon CloudFront

Target:

```text
Browser
   ↓
CloudFront
   ↓
S3
   ↓
React + Vite
```

---

## Backend

- Node.js
- TypeScript
- Express
- OpenAI SDK
- Docker
- Amazon ECR
- Amazon ECS
- AWS Fargate

The backend will initially be **stateless**.

The client sends the conversation history with each chat request.

---

## AI Providers

### Primary

OpenAI API

### Future fallback

Amazon Bedrock

Initial architecture:

```text
Chat Service
     ↓
OpenAI SDK
     ↓
OpenAI API
```

Future architecture:

```text
              ┌── OpenAI
              │
Chat Service ─┤
              │
              └── Bedrock
```

The provider abstraction should be designed so that adding Bedrock later does not require changing the public Chat API.

### Fallback strategy

Fallback should primarily be triggered by transient/provider availability problems, such as:

- HTTP 5xx
- timeout
- rate limiting
- temporary provider availability issues

It should **not** normally be triggered by client/request errors such as HTTP 400.

For streaming, fallback should occur only before the response stream has meaningfully started. Once tokens have already been sent to the client, switching providers mid-response is unsafe.

---

# 3. Target Architecture

The architecture will evolve throughout the project.

High-level target:

```text
                         Internet
                            │
             ┌──────────────┴──────────────┐
             │                             │
        CloudFront                    API Gateway
             │                             │
             ↓                             ↓
             S3                           WAF
                                           │
                                           ↓
                                          ALB
                                           │
                         ┌─────────────────┴─────────────────┐
                         │                                   │
                       AZ-a                                AZ-b
                         │                                   │
                    Private subnet                     Private subnet
                         │                                   │
                    ECS Fargate                        ECS Fargate
                         │                                   │
                         └─────────────────┬─────────────────┘
                                           │
                                           ↓
                                      Chat Service
                                           │
                                           ↓
                                       OpenAI API
```

Supporting AWS services will include:

- IAM Identity Center
- IAM
- VPC
- Internet Gateway
- NAT Gateway
- Route Tables
- Security Groups
- ECS
- Fargate
- ECR
- ALB
- API Gateway
- WAF
- Secrets Manager
- CloudFront
- S3

Additional services will be introduced later.

---

# 4. Architectural Principles

## Production-like

The architecture should resemble something that could realistically be deployed by a company.

This means:

- multi-AZ deployment
- private ECS tasks
- public ALB
- API Gateway in front of the application
- WAF
- rate limiting
- secrets stored in Secrets Manager
- containerized backend
- health checks
- stateless API
- streaming responses
- separation between frontend and backend
- clear security boundaries

---

## Learn before abstracting

Infrastructure will initially be created manually using the **AWS Console**.

No Terraform/CDK/CloudFormation during the learning phase.

Later, once the architecture is understood, the infrastructure can be recreated using IaC.

---

# 5. Phase 0 — AWS Account & Project Setup

## Goal

Prepare the AWS account before creating project infrastructure.

The goal is to prevent the new Chat RAG resources from becoming mixed with resources belonging to existing projects.

---

## 5.1 Root User

The AWS root user should **not** be used for everyday AWS administration.

Initial tasks:

- secure the root account
- enable MFA
- verify account recovery/contact information
- understand what operations require root access
- keep root credentials for account-level/emergency operations only

Target model:

```text
Root User
    │
    └── Account-level / emergency operations
```

---

## 5.2 IAM Identity Center

Configure **AWS IAM Identity Center** for everyday AWS Console access.

Target:

```text
User
  ↓
IAM Identity Center
  ↓
Permission Set / AWS Account
  ↓
AWS Console
```

This will also introduce the distinction between:

- identity
- authentication
- authorization
- IAM roles
- permission sets

Later we can examine integration with an external identity provider such as Microsoft Entra ID.

---

## 5.3 Project Separation

There is no need to create a separate AWS account initially.

Use one AWS account with clear resource separation:

```text
AWS Account
│
├── Existing project
│   └── Existing resources
│
└── chat-rag
    ├── VPC
    ├── ECS
    ├── ECR
    ├── ALB
    ├── API Gateway
    ├── WAF
    ├── S3
    └── CloudFront
```

Existing resources should not be reused unless explicitly intended.

For example, create a dedicated ECR repository:

```text
chat-rag-api
```

rather than using an existing project's ECR repository.

---

## 5.4 Naming Convention

Use a consistent project prefix:

```text
chat-rag-*
```

Examples:

```text
chat-rag-vpc
chat-rag-alb
chat-rag-cluster
chat-rag-api
chat-rag-api-ecr
chat-rag-api-sg
```

The exact naming convention will be finalized before resource creation.

---

## 5.5 Tags

Use project-level tags such as:

```text
Project     = chat-rag
Environment = lab
```

Additional tags can be introduced later, for example:

```text
Component = backend
Component = frontend
ManagedBy = console
```

Tags will make it easier to:

- identify resources
- filter resources
- understand ownership
- analyze costs
- clean up the lab

---

## Phase 0 completion criteria

Before moving to networking:

- [ ] Root account secured
- [ ] Root MFA configured
- [ ] IAM Identity Center configured
- [ ] Daily administrative access works without root
- [ ] Project naming convention established
- [ ] Project tags established
- [ ] Existing resources identified
- [ ] New Chat RAG resources will use separate names/repositories

---

# 6. Phase 1 — Networking

## Goal

Build and understand the AWS network that will host the backend.

Target:

```text
VPC
│
├── AZ-a
│   ├── Public subnet
│   └── Private subnet
│
└── AZ-b
    ├── Public subnet
    └── Private subnet
```

### Components

Create and understand:

- VPC
- CIDR block
- Availability Zones
- public subnets
- private subnets
- Internet Gateway
- NAT Gateway
- route tables
- routes
- Security Groups

### Topics to understand

- What is a VPC?
- What is a subnet?
- Why multiple AZs?
- What makes a subnet public/private?
- What does an Internet Gateway do?
- What does a NAT Gateway do?
- Why should ECS tasks be private?
- How does traffic leave a private subnet?
- What is a route table?
- How do Security Groups work?

### Verification

Understand the traffic flow:

```text
Internet
   ↓
Internet Gateway
   ↓
Public subnet
```

and:

```text
Private subnet
   ↓
NAT Gateway
   ↓
Internet Gateway
   ↓
Internet
```

Phase 1 is complete when the networking model is understood, not simply when the resources exist.

---

# 7. Phase 2 — Containerized Backend

## Goal

Run a minimal Express application on ECS Fargate.

Application:

```http
GET /health
```

Expected response:

```json
{
  "status": "ok"
}
```

### Components

- Express
- TypeScript
- Docker
- ECR
- ECS Cluster
- ECS Task Definition
- Fargate Task
- IAM roles
- Security Groups

### Learning goals

Understand:

- Docker image
- ECR repository
- ECS cluster
- task definition
- task
- container
- Fargate
- CPU/memory configuration
- task execution role
- task role
- container networking

---

# 8. Phase 3 — Application Load Balancer

## Goal

Put the ECS service behind an ALB.

```text
Internet
   ↓
ALB
   ↓
ECS Fargate
   ↓
Express
```

### Components

- Application Load Balancer
- Target Group
- Listener
- Health Check
- Security Groups

### Learning goals

Understand:

- why ALB exists
- target registration
- health checks
- listener vs target group
- ALB security groups
- ECS service integration
- multi-AZ load balancing

At the end:

```text
GET /health
```

should travel through the ALB and reach ECS.

---

# 9. Phase 4 — API Gateway

## Goal

Introduce API Gateway in front of the ALB.

```text
Client
   ↓
API Gateway
   ↓
ALB
   ↓
ECS
   ↓
Express
```

### Learning goals

Understand:

- API Gateway
- API routes
- integrations
- stages
- throttling
- API-level controls
- API Gateway vs ALB

The reason for using both should be clear.

---

# 10. Phase 5 — Security & Public API Protection

## Goal

Protect the public anonymous API before exposing the chat.

Target:

```text
Client
   ↓
API Gateway
   ↓
WAF
   ↓
ALB
   ↓
ECS
```

### Components

- AWS WAF
- rate limiting
- Security Groups
- IAM
- Secrets Manager

### Secrets

Store:

```text
OPENAI_API_KEY
```

in:

```text
AWS Secrets Manager
```

The secret must never be:

- committed to Git
- included in the Docker image
- hardcoded in source code
- exposed to the frontend

ECS receives the secret at runtime.

---

# 11. Phase 6 — React Frontend

## Goal

Create the actual chat frontend.

Stack:

- React
- Vite
- TypeScript
- Vercel AI SDK

Initial UI:

```text
┌─────────────────────────────────┐
│             AI Chat             │
│                                 │
│ User: What is AWS Lambda?       │
│                                 │
│ AI: AWS Lambda is...            │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ Ask something...             │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

The client maintains the conversation state.

No database yet.

---

# 12. Phase 7 — S3 + CloudFront

## Goal

Deploy the React application using AWS.

```text
React + Vite
    ↓
npm run build
    ↓
S3
    ↓
CloudFront
    ↓
Browser
```

### Learning goals

Understand:

- static hosting
- S3 objects
- CloudFront distribution
- caching
- origins
- cache invalidation
- SPA routing

At this stage the frontend and backend will be independently deployed.

---

# 13. Phase 8 — Real AI Chat + Production Streaming

## Goal

Implement real AI chat with production-style streaming.

Target:

```text
Browser
   │
   │ POST /chat
   ↓
API Gateway
   ↓
WAF
   ↓
ALB
   ↓
ECS / Express
   ↓
OpenAI
```

Streaming response:

```text
OpenAI
   │
   │ streaming chunks
   ↓
Express
   │
   │ streaming response
   ↓
ALB
   ↓
API Gateway
   ↓
Browser
```

The browser should display the response progressively rather than waiting for the complete response.

---

## Initial API

```http
POST /chat
```

Example request:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "What is AWS?"
    }
  ]
}
```

The client sends the conversation history.

The backend remains stateless.

---

# 14. Phase 9 — Authentication

Authentication is **not part of V1**.

Initially:

```text
React
  ↓
API
  ↓
Anonymous Chat
```

Later:

```text
                    ┌── Anonymous
                    │
React → API → Chat ─┤
                    │
                    └── Authenticated
                           ↓
                        Cognito
```

### Components

- Amazon Cognito
- User Pool
- JWT
- authenticated API requests

The same endpoint should support both modes:

```http
POST /chat
```

The backend will distinguish authenticated and anonymous requests based on authentication context.

---

# 15. Phase 10 — Conversation Persistence

Current architecture:

```text
Browser
   ↓
conversation state
```

No database.

Later:

```text
Browser
   ↓
API
   ↓
Chat Service
   ↓
Conversation Store
```

The database technology will be selected based on the required access patterns.

Potential options will be evaluated when this phase begins.

---

# 16. Phase 11 — RAG

Introduce retrieval capabilities.

Target:

```text
                 ┌── OpenAI
                 │
Chat Service ────┤
                 │
                 └── RAG
                       ↓
                  Knowledge Base
```

Potential AWS components:

- S3
- ingestion pipeline
- document processing
- chunking
- embeddings
- vector store
- Amazon Bedrock Knowledge Bases
- OpenSearch or another vector database

The exact RAG architecture will be designed when this phase begins.

---

# 17. Phase 12 — Agentic Capabilities

Once basic Chat + RAG works, introduce agents and tools.

Potential architecture:

```text
User
 ↓
Chat API
 ↓
Agent
 ├── LLM
 ├── RAG
 ├── Tools
 └── External services
```

Potential technologies:

- OpenAI Agents SDK
- AG UI
- tool calling
- MCP
- structured outputs
- human-in-the-loop

AG UI becomes significantly more useful at this stage.

---

# 18. Phase 13 — Observability & Production Hardening

Add operational capabilities.

Potential components:

- CloudWatch Logs
- CloudWatch Metrics
- Cloud Watch GenerativeAI Observability
- alarms
- distributed tracing
- structured logging
- request IDs
- correlation IDs
- application metrics
- dashboards
- error monitoring
- MLFlow on AWS Sagemaker (MLflow Tracking Servers i nowsze MLflow Apps) [https://docs.aws.amazon.com/sagemaker/latest/dg/mlflow.html?utm_source=chatgpt.com]
- guardrails for AI safety and reliability

Also investigate:

- retries
- timeouts
- circuit breakers
- provider fallback
- graceful degradation
- autoscaling
- deployment strategies

---

# 19. Phase 14 — CI/CD

Only after the architecture works manually.

Potential backend pipeline:

```text
GitHub
   ↓
GitHub Actions
   ↓
Build
   ↓
Test
   ↓
Docker
   ↓
ECR
   ↓
ECS deployment
```

Frontend:

```text
GitHub
   ↓
Build React
   ↓
S3
   ↓
CloudFront
```

---

# 20. Phase 15 — Infrastructure as Code

After manually building and understanding the infrastructure:

```text
AWS Console
     ↓
understand
     ↓
document
     ↓
IaC
```

Potential technologies:

- AWS CDK
- Terraform
- CloudFormation

The objective is to reproduce the architecture using IaC rather than hiding the architecture behind IaC from the beginning.

---

# 21. Final Target

The eventual application should evolve toward:

```text
                         ┌───────────────┐
                         │    Cognito    │
                         └───────┬───────┘
                                 │
Browser                          │
   │                             │
   ↓                             │
CloudFront                       │
   │                             │
   ↓                             │
S3 / React                       │
   │                             │
   └──────────────┐              │
                  ↓              ↓
              API Gateway ← Authentication
                  │
                 WAF
                  │
                 ALB
                  │
          ┌───────┴────────┐
          │                │
       ECS AZ-a         ECS AZ-b
          │                │
          └───────┬────────┘
                  │
             Chat Service
                  │
        ┌─────────┼─────────┐
        │         │         │
     OpenAI    Bedrock     RAG
        │                   │
        │                Knowledge
        │                  Base
        │
        └──────────┬────────┘
                   │
             Conversation
                Store
```

---

# 22. Current Milestone

## Phase 0 — AWS Account & Project Setup

We are currently here.

### Next steps

1. Secure the AWS root user.
2. Configure MFA.
3. Configure IAM Identity Center.
4. Create daily administrative access.
5. Establish `chat-rag` naming conventions.
6. Establish project tags.
7. Identify existing AWS resources that must remain separate.
8. Create the project-specific ECR repository only when we reach the container phase.
9. Move to Phase 1 — Networking.

---

# 23. Learning Rule

For every AWS component we create, answer three questions:

### What is it?

What AWS resource are we creating?

### Why do we need it?

What problem does it solve?

### What happens without it?

What breaks or changes if we remove it?

This keeps the project focused on **understanding architecture**, rather than simply following a deployment tutorial.
