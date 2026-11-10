# ==========================================
# Stage 1: Base Environment
# ==========================================
FROM node:22-alpine AS base

RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
WORKDIR /app

# ==========================================
# Stage 2: Dependencies & Build
# ==========================================
FROM base AS builder

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY adapters/ adapters/
COPY apps/ apps/
COPY migrations/ migrations/

RUN pnpm approve-builds --all && pnpm install --frozen-lockfile
RUN pnpm build

# ==========================================
# Stage 3: Production Minimal Runtime
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Run as non-privileged system user
RUN addgroup -S linklet && adduser -S linklet -G linklet

COPY --from=builder --chown=linklet:linklet /app/node_modules ./node_modules
COPY --from=builder --chown=linklet:linklet /app/packages ./packages
COPY --from=builder --chown=linklet:linklet /app/adapters ./adapters
COPY --from=builder --chown=linklet:linklet /app/apps/queue-consumer-node ./apps/queue-consumer-node
COPY --from=builder --chown=linklet:linklet /app/package.json ./package.json

USER linklet

WORKDIR /app/apps/queue-consumer-node
CMD ["node", "dist/index.js"]

