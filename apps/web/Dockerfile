# --- Dependencies: only those on package.json ---
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api/package.json packages/api/
RUN bun install --frozen-lockfile

# --- Build de l'application React Router + serveur Hono ---
FROM deps AS build
COPY . .
RUN cd apps/web && bun run build

# --- Image finale ---
FROM oven/bun:1 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["bun", "./build/server/index.js"]
