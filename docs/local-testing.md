# Lokalne testowanie Phase 8

Lokalne środowisko działa w układzie:

```text
Frontend Vite lokalnie
        ↓
Express lokalnie
        ↓
PostgreSQL 18.3 w Dockerze
```

Na obecnym etapie nie uruchamiaj całego stosu przez `pnpm compose:local:up`. W konfiguracji Compose występuje konflikt między `NODE_ENV=production` i lokalnym połączeniem PostgreSQL bez TLS. Poniższa procedura uruchamia PostgreSQL w Dockerze, a API i frontend bezpośrednio na hoście.

## 1. Przygotowanie

Zainstaluj zależności z katalogu głównego repozytorium:

```bash
pnpm install
```

W pliku `.env.local` ustaw prawdziwy klucz OpenAI:

```env
OPENAI_API_KEY=...
```

Nie kopiuj ponownie pliku przykładowego, jeśli `.env.local` zawiera już prawdziwy klucz.

## 2. Uruchom PostgreSQL

```bash
docker compose \
  --env-file .env.local \
  -f docker-compose.local.yml \
  up -d postgres
```

Sprawdź stan kontenera:

```bash
docker compose \
  --env-file .env.local \
  -f docker-compose.local.yml \
  ps postgres
```

PostgreSQL powinien mieć status `healthy` i być dostępny pod `localhost:5432`.

## 3. Wykonaj migrację

```bash
DATABASE_URL='postgresql://chat_rag_migrate:local-migration-password@localhost:5432/postgres?sslmode=disable' \
pnpm db:migrate
```

Migrację można uruchamiać wielokrotnie. Jeżeli wszystkie migracje zostały już wykonane, kolejne uruchomienie powinno zakończyć się bez zmian.

Sprawdź utworzone tabele:

```bash
docker compose \
  --env-file .env.local \
  -f docker-compose.local.yml \
  exec postgres \
  psql -U chat_rag_admin -d postgres -c '\dt'
```

Powinny istnieć tabele:

```text
users
conversations
messages
```

## 4. Zaloguj się przez AWS SSO

Lokalny backend korzysta z Bedrock Guardrails, dlatego potrzebuje aktywnej sesji AWS:

```bash
aws sso login --profile news-monitor-dev
aws sts get-caller-identity --profile news-monitor-dev
```

## 5. Uruchom backend lokalny

W pierwszym terminalu, z katalogu głównego repozytorium:

```bash
set -a
source .env.local
set +a

export AWS_PROFILE=news-monitor-dev
export AWS_REGION=eu-central-1
export BEDROCK_GUARDRAIL_ID=wrbzgwf3rz1e
export BEDROCK_GUARDRAIL_VERSION=1

export NODE_ENV=development
export DATABASE_SSL_MODE=disable
export DATABASE_URL='postgresql://chat_rag_app:local-app-password@localhost:5432/postgres?sslmode=disable'

export FRONTEND_ORIGINS=http://localhost:5173
export COGNITO_ISSUER=https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_69mO0i9j6
export COGNITO_CLIENT_ID=5ok5j2hpla2be0gorpdblpheuv

pnpm dev:api
```

Sprawdź endpoint zdrowia:

```bash
curl http://localhost:8000/health
```

W tym trybie żądania nie przechodzą przez API Gateway. Express bezpośrednio weryfikuje Access Token wystawiony przez Cognito.

## 6. Uruchom frontend lokalny

W drugim terminalu, z katalogu głównego repozytorium:

```bash
VITE_API_URL= pnpm dev:web
```

Otwórz w przeglądarce:

```text
http://localhost:5173
```

Puste `VITE_API_URL` powoduje, że Vite przekazuje żądania `/v1/*` do lokalnego API:

```text
frontend /v1/*
    ↓ Vite proxy
http://localhost:8000/v1/*
```

Logowanie korzysta z rzeczywistego Cognito. Adres `http://localhost:5173` musi być dozwolonym callback URL i logout URL-em w konfiguracji Cognito App Client.

## 7. Test manualny

1. Zaloguj się użytkownikiem Cognito.
2. Wyślij pierwszą wiadomość.
3. Sprawdź, czy rozmowa pojawiła się na liście.
4. Odśwież stronę i sprawdź, czy rozmowa oraz wiadomości zostały odtworzone.
5. Wyślij kolejną wiadomość w tej samej rozmowie. Model powinien otrzymać wcześniejszy kontekst.
6. Kliknij `New chat`.
7. Wyślij wiadomość. Powinna powstać druga rozmowa.
8. Przełączaj się między rozmowami i sprawdź ich historię.
9. Wyloguj się i zaloguj drugim użytkownikiem Cognito. Drugi użytkownik nie powinien widzieć rozmów pierwszego.

## 8. Sprawdź dane w PostgreSQL

Otwórz klienta `psql` w kontenerze:

```bash
docker compose \
  --env-file .env.local \
  -f docker-compose.local.yml \
  exec postgres \
  psql -U chat_rag_admin -d postgres
```

Sprawdź użytkowników, rozmowy i wiadomości:

```sql
SELECT id, cognito_subject, created_at
FROM users;

SELECT id, user_id, title, activity_at
FROM conversations
ORDER BY activity_at DESC;

SELECT id, conversation_id, role, status, content, created_at
FROM messages
ORDER BY id;
```

Wyjdź z `psql`:

```text
\q
```

## 9. Testy automatyczne

Uruchom typechecki i testy jednostkowe:

```bash
pnpm typecheck:api
pnpm typecheck:web
pnpm test:api
pnpm test:web
```

Uruchom pełny zestaw testów API z prawdziwym PostgreSQL:

```bash
POSTGRES_INTEGRATION_DATABASE_URL='postgresql://chat_rag_migrate:local-migration-password@localhost:5432/chat_rag_test?sslmode=disable' \
POSTGRES_INTEGRATION_APPLICATION_DATABASE_URL='postgresql://chat_rag_app:local-app-password@localhost:5432/chat_rag_test?sslmode=disable' \
pnpm --filter @chat-rag/api exec vitest run \
  --config vitest.config.ts \
  --no-file-parallelism
```

Testy są wykonywane szeregowo, ponieważ współdzielą lokalną bazę `chat_rag_test` i czyszczą jej tabele między przypadkami testowymi.

## 10. Zatrzymanie środowiska

Zatrzymaj API i frontend przez `Ctrl+C` w ich terminalach, a następnie zatrzymaj PostgreSQL:

```bash
docker compose \
  --env-file .env.local \
  -f docker-compose.local.yml \
  stop postgres
```

Dane pozostają w lokalnym volume `chat-rag-local-postgres-data`.

## Znane ograniczenia

Przed uznaniem lokalnej ścieżki za w pełni gotową należy poprawić:

- konflikt `NODE_ENV=production` i `DATABASE_SSL_MODE=disable` w pełnym Docker Compose;
- `db:reset`, który obecnie nie gwarantuje usunięcia używanego volume;
- skrypt `test:integration`, który obecnie uruchamia tylko test migracji.
