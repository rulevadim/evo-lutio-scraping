# Node 24 — Active LTS (22 уже в maintenance, 20 снят с поддержки).
FROM node:24-bookworm-slim AS build
WORKDIR /app

# pnpm берётся из поля packageManager в package.json — версия фиксирована.
RUN corepack enable

# Слой зависимостей кешируется отдельно от исходников.
COPY package.json pnpm-lock.yaml ./
# better-sqlite3 обычно ставится из prebuild; сборочные инструменты — на случай,
# когда готового бинаря под платформу нет.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── Рантайм ──────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    DB_PATH=/data/blog.db

# SHA сборки: healthcheck отдаёт его наружу, а smoke-тест деплоя сверяет с тем,
# что деплоили, — иначе можно зачесть здоровый старый контейнер.
ARG BUILD_SHA=dev
ENV BUILD_SHA=$BUILD_SHA

# Nitro кладёт better-sqlite3 (вместе с .node-бинарём) прямо в .output —
# докопировать зависимости руками не нужно.
COPY --from=build /app/.output ./.output

# Не от root: иначе SQLite создаст blog.db-wal и blog.db-shm с владельцем root
# на примонтированном томе, и сменить это снаружи будет неудобно.
# UID/GID фиксированы, чтобы совпасть с владельцем каталога на хосте.
RUN groupadd --gid 10001 app \
  && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
  && mkdir -p /data \
  && chown -R app:app /app /data
USER app:app

EXPOSE 3000

# Проверяем именно готовность (см. server/api/healthz.get.ts), а не «процесс жив».
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
