# paperless-ingestion-bot — Signal and Gmail document ingestion for Paperless-ngx
# Multi-stage build for smaller image

FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY config.example.json ./
RUN npm run build

# Production image
FROM node:24-alpine

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config.example.json ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

USER app

ENV NODE_ENV=production
ENV PAPERLESS_INGESTION_CONFIG=/etc/paperless-ingestion-bot/config.json

ENTRYPOINT ["node", "dist/cli.js"]
