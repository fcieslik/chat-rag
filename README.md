# Chat RAG

Anonymous AI chat with a React/Vite frontend and an Express streaming API.

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

Open the frontend at [http://localhost:8080](http://localhost:8080). The services are:

```text
Frontend: http://localhost:8080
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

Open [http://localhost:5173](http://localhost:5173). The empty environment variables override the AWS value from `apps/web/.env.local`, so Vite proxies `/v1/chat` to the local API on port `8000`.

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
Headers: Content-Type
Origin:  http://localhost:5173
```

The deployed API must also return `Access-Control-Allow-Origin` on the `POST` response. Without this configuration, the browser will block the request even though the endpoint itself is reachable.

Example direct request:

```bash
curl -N https://2780017ujg.execute-api.eu-central-1.amazonaws.com/prod/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Reply with one short sentence."}'
```

The response is streamed as SSE events:

```text
data: {"delta":"..."}
data: [DONE]
```

## Production build

For a different API endpoint, provide the full chat URL during the build:

```bash
VITE_CHAT_API_URL=https://api.example.com/prod/chat pnpm build:web
```

The generated static files are in `apps/web/dist/` and can be uploaded to S3.

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
