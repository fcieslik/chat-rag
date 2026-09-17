FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --filter @chat-rag/web... --frozen-lockfile

COPY apps/web apps/web

ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm --filter @chat-rag/web build

FROM nginx:1.29-alpine AS production

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
