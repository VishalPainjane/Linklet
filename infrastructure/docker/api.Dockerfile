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

# Approve esbuild for pnpm v12 and install dependencies
RUN pnpm approve-builds --all && pnpm install --frozen-lockfile
RUN pnpm build

# ==========================================
# Stage 3: Production Minimal Runtime
# ==========================================
FROM node:22-alpine AS runner

RUN apk add --no-cache curl

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Run as non-privileged system user
RUN addgroup -S linklet && adduser -S linklet -G linklet

COPY --from=builder --chown=linklet:linklet /app/node_modules ./node_modules
COPY --from=builder --chown=linklet:linklet /app/packages ./packages
COPY --from=builder --chown=linklet:linklet /app/adapters ./adapters
COPY --from=builder --chown=linklet:linklet /app/apps/api-node ./apps/api-node
COPY --from=builder --chown=linklet:linklet /app/migrations ./migrations
COPY --from=builder --chown=linklet:linklet /app/package.json ./package.json

USER linklet
EXPOSE 3001

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=5 \
  CMD curl -f http://localhost:3001/health || exit 1

WORKDIR /app/apps/api-node
CMD ["node", "dist/server.js"]

