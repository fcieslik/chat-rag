#!/usr/bin/env bash
set -euo pipefail

environment_file=.env.local
database_url="${LOCAL_MIGRATION_DATABASE_URL:-}"

if [[ -z "$database_url" && -f "$environment_file" ]]; then
  database_url=$(sed -n 's/^LOCAL_MIGRATION_DATABASE_URL=//p' "$environment_file" | tail -n 1)
fi

database_url="${database_url:-postgresql://chat_rag_migrate:local-migration-password@localhost:5432/postgres?sslmode=disable}"

if [[ ! "$database_url" =~ ^postgres(ql)?://[^@]+@(localhost|127\.0\.0\.1|postgres)(:[0-9]+)?/(postgres|chat_rag_test)(\?.*)?$ ]]; then
  echo "db:reset refuses non-local LOCAL_MIGRATION_DATABASE_URL" >&2
  exit 1
fi

docker compose --env-file "$environment_file" -f docker-compose.local.yml stop postgres
docker volume rm chat-rag-local-postgres-data >/dev/null 2>&1 || true
docker compose --env-file "$environment_file" -f docker-compose.local.yml up -d postgres
docker compose --env-file "$environment_file" -f docker-compose.local.yml up --wait postgres

pnpm build:api
DATABASE_URL="$database_url" pnpm --filter @chat-rag/api db:migrate
