FROM oven/bun:1.4.2 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY web/package.json web/package.json
COPY api/package.json api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/browser-admission/package.json packages/browser-admission/package.json
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY web web
COPY api api
RUN bun run build

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
COPY --from=build --chown=bun:bun /app/web/dist web/dist
COPY --from=build --chown=bun:bun /app/api/dist api/dist
ENV AUTHENTICATOR_HOST=0.0.0.0
ENV PORT=4173
USER bun
EXPOSE 4173
CMD ["bun", "api/dist/main.js"]
