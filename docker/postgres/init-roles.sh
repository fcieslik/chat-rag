#!/usr/bin/env sh
set -eu

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=migration_password="$LOCAL_MIGRATION_PASSWORD" \
  --set=app_password="$LOCAL_APP_PASSWORD" <<'SQL'
CREATE ROLE chat_rag_migrate LOGIN PASSWORD :'migration_password';
CREATE ROLE chat_rag_app LOGIN PASSWORD :'app_password';
CREATE DATABASE chat_rag_test OWNER chat_rag_migrate;
GRANT CONNECT ON DATABASE postgres TO chat_rag_migrate, chat_rag_app;
GRANT CONNECT ON DATABASE chat_rag_test TO chat_rag_migrate, chat_rag_app;
GRANT CREATE ON DATABASE postgres TO chat_rag_migrate;
GRANT CREATE ON DATABASE chat_rag_test TO chat_rag_migrate;
GRANT USAGE, CREATE ON SCHEMA public TO chat_rag_migrate;
SQL
