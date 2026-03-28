# ============================================================
# Stage 1: Build frontend
# ============================================================
FROM node:22-alpine AS web-builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

# Install dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY src/shared/package.json ./src/shared/
COPY src/web/package.json ./src/web/
COPY src/api/package.json ./src/api/

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY src/shared ./src/shared
COPY src/web ./src/web
COPY tsconfig.json ./

RUN pnpm --filter @dblumi/shared build
RUN pnpm --filter @dblumi/web build
# Output: src/api/public/

# ============================================================
# Stage 2: Build backend
# ============================================================
FROM node:22-alpine AS api-builder

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY src/shared/package.json ./src/shared/
COPY src/api/package.json ./src/api/
COPY src/web/package.json ./src/web/

RUN pnpm install --frozen-lockfile --filter @dblumi/api...

COPY src/shared ./src/shared
COPY src/api ./src/api
COPY tsconfig.json ./

RUN pnpm --filter @dblumi/shared build
RUN pnpm --filter @dblumi/api build
# Copy frontend assets from previous stage
COPY --from=web-builder /build/src/api/public ./src/api/public

# ============================================================
# Stage 3: Production image
# ============================================================
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apk add --no-cache dumb-init

WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies only
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY src/shared/package.json ./src/shared/
COPY src/api/package.json ./src/api/
COPY src/web/package.json ./src/web/

RUN pnpm install --frozen-lockfile --filter @dblumi/api... --prod

# Copy built artifacts
COPY --from=api-builder /build/src/shared/dist ./src/shared/dist
COPY --from=api-builder /build/src/api/dist ./src/api/dist
COPY --from=api-builder /build/src/api/public ./src/api/public
COPY --from=api-builder /build/src/api/migrations ./src/api/migrations

# Data volume
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/api/dist/index.js"]
