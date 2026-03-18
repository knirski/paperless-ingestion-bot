# paperless-ingestion-bot — Signal and Gmail document ingestion for Paperless-ngx
# Multi-stage build for smaller image

FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
COPY config.example.json ./
RUN bun run build

# Production image
FROM oven/bun:1-alpine

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config.example.json ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock ./
RUN bun install --frozen-lockfile --production

USER app

ENV NODE_ENV=production
# Config: file at default path. Override individual keys with PAPERLESS_INGESTION_* env vars (12-factor).

ENTRYPOINT ["bun", "dist/cli.js"]
