# Web

React + Vite client for the Cognito-authenticated chat API.

## Development

From the repository root:

```bash
pnpm install
pnpm dev:web
```

The Vite development server proxies `/v1` to `http://localhost:8000`. Start the API separately with `pnpm dev:api`, then open `http://localhost:5173` and sign in.

Because `apps/web/.env.local` is configured for AWS testing, use the following command when you want to test against the local API instead:

```bash
VITE_API_URL= pnpm dev:web
```

For a deployed frontend, set `VITE_API_URL` to the public API origin before building, for example:

```bash
VITE_API_URL=https://api.example.com pnpm build:web
```

Set the API's `FRONTEND_ORIGINS` to a comma-separated list of allowed frontend origins, for example `http://localhost:5173,https://chat.example.com`, to enable browser requests from those frontends.

The API must validate `COGNITO_ISSUER=https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_69mO0i9j6` and `COGNITO_CLIENT_ID=5ok5j2hpla2be0gorpdblpheuv`. API Gateway must expose the Conversation routes and return CORS headers for `http://localhost:5173` during browser testing.

For a different environment, copy `.env.example` to `.env.local` and set the `VITE_COGNITO_*` values. Do not add a client secret: the static SPA uses a public Cognito app client with Authorization Code Grant and PKCE.

The client creates first Turns with `POST /v1/conversations` and appends later Turns with `POST /v1/conversations/:conversationId/messages` using `{ "message": "...", "clientMessageId": "<uuid>" }`. It renders `response.delta` events until `response.completed`.

## Local Docker test

Copy `docker-compose.local.env.example` to `.env.local` in the repository root and add your OpenAI key. Then run:

```bash
pnpm compose:local:up
```

Open `http://localhost:8080`. The frontend runs in Nginx and the API runs on port `8000`. Stop the stack with:

```bash
pnpm compose:local:down
```
