FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/api/package.json packages/api/
RUN bun install --frozen-lockfile

FROM deps AS runtime
ENV NODE_ENV=production
COPY packages/api packages/api
COPY apps/worker apps/worker
WORKDIR /app/apps/worker
CMD ["bun", "src/scraper/run.ts"]
