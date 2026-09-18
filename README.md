# Chat RAG

AI chat with a React/Vite frontend authenticated by Cognito and an Express streaming API.

## Local development

### Option 1: Docker Compose

Copy the local environment template and add an OpenAI API key:

```bash
cp docker-compose.local.env.example .env.local
```

Then start the complete local stack:

```bash
pnpm compose:local:up
```

Open the frontend at [http://localhost:5173](http://localhost:5173) and sign in with a user from the configured Cognito User Pool. The services are:

```text
Frontend: http://localhost:5173
API:      http://localhost:8000
Chat:     POST http://localhost:8000/v1/chat
Health:   GET  http://localhost:8000/health
```

Stop the stack:

```bash
pnpm compose:local:down
```

### Option 2: Vite development server

Start the API and frontend in separate terminals:

```bash
pnpm dev:api
VITE_CHAT_API_URL= VITE_API_URL= pnpm dev:web
```

Open [http://localhost:5173](http://localhost:5173), sign in, and use the chat. The empty environment variables override the AWS value from `apps/web/.env.local`, so Vite proxies `/v1/chat` to the local API on port `8000`.

The frontend Cognito defaults match the current User Pool. For another environment, copy `apps/web/.env.example` to `apps/web/.env.local` and set the `VITE_COGNITO_*` values. The Cognito app client must be a public client using Authorization Code Grant with PKCE, and must allow `http://localhost:5173` as callback and sign-out URLs.

## Testing the AWS API from the frontend

The file `apps/web/.env.local` contains the configured API Gateway endpoint:

```env
VITE_CHAT_API_URL=https://2780017ujg.execute-api.eu-central-1.amazonaws.com/prod/chat
```

Start Vite:

```bash
pnpm dev:web
```

Then open [http://localhost:5173](http://localhost:5173). Vite loads `.env.local` and sends requests directly to the AWS URL.

The AWS API must allow CORS for the origin used by the browser. Configure the ECS task definition with a comma-separated `FRONTEND_ORIGINS` value, for example:

```text
FRONTEND_ORIGINS=http://localhost:5173,https://YOUR-FRONTEND-DOMAIN
```

Configure the API Gateway route `/chat` to support `OPTIONS` and allow:

```text
Methods: POST, OPTIONS
Headers: Content-Type, Authorization
Origin:  http://localhost:5173
```

The deployed API must also return `Access-Control-Allow-Origin` on the `POST` response. Without this configuration, the browser will block the request even though the endpoint itself is reachable.

Example direct request:

```bash
curl -N https://2780017ujg.execute-api.eu-central-1.amazonaws.com/prod/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <cognito-access-token>" \
  -d '{"message":"Reply with one short sentence."}'
```

The response is streamed as SSE events:

```text
data: {"delta":"..."}
data: [DONE]
```

## Production build

For a different API endpoint or Cognito environment, provide the values during the build:

```bash
VITE_CHAT_API_URL=https://api.example.com/prod/chat \
VITE_COGNITO_AUTHORITY=https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_example \
VITE_COGNITO_CLIENT_ID=example-client-id \
VITE_COGNITO_DOMAIN=https://example.auth.eu-central-1.amazoncognito.com \
pnpm build:web
```

The generated static files are in `apps/web/dist/` and can be uploaded to S3.

The production CloudFront/custom-domain origin must be registered in Cognito as both an allowed callback URL and an allowed sign-out URL. The API/ECS environment must include `COGNITO_ISSUER`, `COGNITO_CLIENT_ID`, and the frontend origins in `FRONTEND_ORIGINS`.

## co zrobic po nowym obrazie

Tak. Przy naszym obecnym setupie, gdy nowy obraz pojawi się w ECR, ręcznie robisz:

GitHub Actions
↓
ECR: nowy image
↓
ECS Task Definition: nowa revision
↓
ECS Service: update → nowa revision
↓
ECS uruchamia nowy task
↓
ALB kieruje ruch do nowego taska

Ta ręczna procedura pozostaje fallbackiem diagnostycznym. Normalny deployment produkcyjny wykonuje GitHub Actions.

Jeśli automatyczny deployment jest niedostępny, wykonaj ten fallback w AWS Console:

1. W ECR `chat-rag-api` potwierdź obraz i jego tag lub digest, który ma zostać wdrożony.
2. W ECS otwórz rodzinę Task Definition `chat-rag-api`, utwórz nową revision i zmień obraz wyłącznie kontenera `chat-rag-api`. Zachowaj pozostałe ustawienia runtime oraz referencje `secrets.valueFrom`.
3. W klastrze `chat-rag-cluster` otwórz service `chat-rag-api-service`, wybierz nową revision i wykonaj update.
4. Poczekaj na stabilność service i sprawdź `GET /prod/health` przez API Gateway.

## Automatyczny deployment API

Workflow znajduje się w `.github/workflows/deploy-api.yml`.

### Feature branches

Push do `feature/**` uruchamia tylko walidację repozytorium:

```bash
pnpm test
pnpm typecheck:api
pnpm typecheck:web
pnpm build:api
pnpm build:web
```

Feature branch nie konfiguruje AWS, nie loguje się do ECR, nie wysyła obrazu i nie aktualizuje ECS.

Zmiany zawierające wyłącznie `docs/agents/**`, `.scratch/**`, `AGENTS.md` lub `CLAUDE.md` są pomijane przez workflow. Commit mieszany, zawierający także kod API albo konfigurację deploymentu, uruchamia workflow normalnie.

### `main`

Push do `main` musi najpierw przejść tę samą walidację. Dla zmian frontend-only, tests-only i innych zmian niezwiązanych z API workflow kończy się po walidacji. Deployment uruchamia się dla zmian w `apps/api/**`, `infra/**`, tym workflow albo głównych manifestach pakietów.

Dla takich zmian workflow:

1. używa GitHub OIDC do przyjęcia istniejącej roli `chat-rag-github-actions`,
2. buduje obraz API i wysyła go do ECR z tagiem `${GITHUB_SHA}`,
3. ładuje `infra/ecs/task-definition.json`,
4. zmienia wyłącznie `image` kontenera `chat-rag-api`,
5. rejestruje nową revision Task Definition,
6. aktualizuje service `chat-rag-api-service` w clusterze `chat-rag-cluster`,
7. czeka na stabilność ECS,
8. wykonuje smoke test przez `GET /prod/health`.

Task Definition pozostaje źródłem prawdy w Git. Referencja `secrets.valueFrom` pozostaje bez zmian, a GitHub Actions nie otrzymuje wartości sekretu.

Oczekiwany smoke test:

```text
GET https://2780017ujg.execute-api.eu-central-1.amazonaws.com/prod/health
→ {"status":"ok"}
```

Po zakończeniu kroku `Deploy to Amazon ECS` workflow ma potwierdzoną stabilność service. W podsumowaniu joba zapisuje commit SHA, pełny tag obrazu oraz ARN zarejestrowanej revision Task Definition, aby nie utracić identyfikatorów potrzebnych do diagnozy.

### Weryfikacja wdrożenia i rollbacku

Granica automatyzacji jest celowa: GitHub Actions automatycznie sprawdza stabilność ECS, nową revision oraz publiczny smoke test API Gateway. Rola `chat-rag-github-actions` nie ma uprawnień odczytu ELBv2 ani CloudWatch Logs, dlatego sprawdzenie targetu ALB i logów CloudWatch pozostaje ręcznym potwierdzeniem operatora w AWS Console lub CLI i nie jest dodatkowym krokiem workflow.

Udane wdrożenie powinno pozostawić następujące ślady:

1. GitHub Actions: krok ECS kończy się po `wait-for-service-stability: true`, jawna kontrola `DescribeServices` potwierdza nową revision i zgodną liczbę działających task, a podsumowanie zawiera ARN Task Definition i obraz oznaczony `${GITHUB_SHA}`.
2. ECS: `chat-rag-api-service` ma jedną działającą taskę na nowej revision, a deployment ma stan `COMPLETED`.
3. ALB (ręcznie): target kontenera `chat-rag-api` w `chat-rag-internal-tg` jest `healthy` dla `GET /health`.
4. CloudWatch (ręcznie): grupa `/ecs/chat-rag-api` zawiera log startu nowej taski i nie pokazuje pętli restartów ani błędów uruchomienia.
5. API Gateway: publiczny endpoint `GET /prod/health` zwraca HTTP 2xx oraz `{"status":"ok"}`.

Kontrolowany test circuit breakera wykonuj osobno, w uzgodnionym oknie utrzymaniowym, nigdy jako część zwykłego workflow. Zarejestruj tymczasową revision z tym samym plikiem Task Definition i jedyną zmianą w `containerDefinitions[].image`: użyj unikalnego, celowo nieistniejącego tagu zawierającego SHA testowego commita, np. `rollback-drill-${GITHUB_SHA}`. Następnie skieruj `chat-rag-api-service` na tę revision i obserwuj ECS. Próba uruchomienia taski zakończy się błędem pobrania obrazu, więc deployment powinien zostać oznaczony jako `FAILED` przez circuit breaker i automatycznie wycofany do ostatniej ukończonej revision. W ECS potwierdź komunikat o zadziałaniu deployment circuit breakera, poprzednią revision jako aktywną oraz zdrowy target ALB. Zachowaj tag obrazu i ARN/revision testowej Task Definition do czasu zakończenia diagnozy i nie usuwaj ich w ramach testu.

Ten test jest niezależny od smoke testu. Jeżeli ECS osiągnie stabilność, a późniejszy request do API Gateway zakończy się błędem HTTP albo odpowiedzią inną niż `{"status":"ok"}`, krok `Verify production health` kończy job GitHub Actions jako nieudany i deployment jest widoczny jako failed production deployment. Taki błąd po stabilizacji ECS nie uruchamia samodzielnie deployment circuit breakera ani nie wykonuje rollbacku ECS.
