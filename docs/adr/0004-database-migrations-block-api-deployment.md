---
status: accepted
---

# Database migrations block API deployment

Every API deployment runs forward-only Drizzle migrations in a one-off ECS task before updating the ECS service. The API and migration use separate Task Definitions and credentials but the exact same image; each definition references its same-region Secrets Manager secret by full ARN (a bare name is interpreted as an SSM parameter), the migration definition supplies the migration command, and the API definition never receives DDL credentials. The workflow copies the existing ECS service's `awsvpc` network configuration when it runs the migration task. An advisory lock serializes concurrent runners, and any non-zero container exit code blocks deployment. This keeps the repository as the schema source of truth without maintaining a second image, duplicating network configuration, or allowing incompatible application code to reach production.
