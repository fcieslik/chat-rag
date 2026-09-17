FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --filter @chat-rag/api... --prod=false --frozen-lockfile

COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src

RUN pnpm --filter @chat-rag/api build

FROM node:22-bookworm-slim AS production

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --filter @chat-rag/api --prod --frozen-lockfile

COPY --from=build /app/apps/api/dist apps/api/dist

USER node

EXPOSE 8000

CMD ["node", "apps/api/dist/server.js"]
