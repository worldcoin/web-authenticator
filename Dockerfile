FROM oven/bun:1.4.2 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/browser-admission/package.json packages/browser-admission/package.json
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY apps/web apps/web
COPY apps/api apps/api
RUN bun run build

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
COPY --from=build --chown=bun:bun /app/apps/web/dist apps/web/dist
COPY --from=build --chown=bun:bun /app/apps/api/dist apps/api/dist
ENV AUTHENTICATOR_HOST=0.0.0.0
ENV PORT=4173
USER bun
EXPOSE 4173
CMD ["bun", "apps/api/dist/main.js"]
