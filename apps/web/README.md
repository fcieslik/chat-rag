# Web

Minimal React + Vite client for the anonymous chat API.

## Development

From the repository root:

```bash
pnpm install
pnpm dev:web
```

The Vite development server uses `/v1/chat` and proxies it to `http://localhost:8000`. Start the API separately with `pnpm dev:api`.

Because `apps/web/.env.local` is configured for AWS testing, use the following command when you want to test against the local API instead:

```bash
VITE_CHAT_API_URL= VITE_API_URL= pnpm dev:web
```

For a deployed frontend, set `VITE_API_URL` to the public API origin before building, for example:

```bash
VITE_API_URL=https://api.example.com pnpm build:web
```

Set the API's `FRONTEND_ORIGINS` to a comma-separated list of allowed frontend origins, for example `http://localhost:5173,https://chat.example.com`, to enable browser requests from those frontends.

For the AWS URL in `apps/web/.env.local`, API Gateway must also expose `OPTIONS /chat` and return CORS headers for `http://localhost:5173` during local browser testing.

The client sends `{ "message": "..." }` to `POST /v1/chat` and progressively renders SSE events in the form `data: {"delta":"..."}` until `data: [DONE]`.

## Local Docker test

Copy `docker-compose.local.env.example` to `.env.local` in the repository root and add your OpenAI key. Then run:

```bash
pnpm compose:local:up
```

Open `http://localhost:8080`. The frontend runs in Nginx and the API runs on port `8000`. Stop the stack with:

```bash
pnpm compose:local:down
```
