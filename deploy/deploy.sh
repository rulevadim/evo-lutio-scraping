#!/usr/bin/env bash
# Выкатить образ на ВМ. Запускается из CI по SSH, но пригоден и вручную.
#
#   ./deploy.sh ghcr.io/user/repo:<sha> <sha>
#
# Свойства:
#  - деплоится КОНКРЕТНЫЙ тег, никогда :latest;
#  - успех подтверждается публичным HTTPS-ответом /api/healthz, причём с
#    проверкой sha — иначе можно зачесть здоровый СТАРЫЙ контейнер;
#  - при любой ошибке выполняется реальный откат на предыдущий образ, и только
#    после этого скрипт падает;
#  - образ предыдущей версии не удаляется — иначе откатываться будет не на что.

set -euo pipefail

cd "$(dirname "$0")"

NEW_REF="${1:?укажите ссылку на образ: ghcr.io/user/repo:<sha>}"
EXPECTED_SHA="${2:?укажите ожидаемый BUILD_SHA}"

IMAGE_ENV=./image.env
WAIT_TIMEOUT=120

# shellcheck disable=SC1091
[ -f ./.env ] && . ./.env
: "${SITE_DOMAIN:?SITE_DOMAIN не задан в .env}"

PREV_REF=""
[ -f "$IMAGE_ENV" ] && PREV_REF="$(sed -n 's/^IMAGE_REF=//p' "$IMAGE_ENV")"

log() { printf '\n▶ %s\n' "$*"; }

write_image_env() { printf 'IMAGE_REF=%s\n' "$1" > "$IMAGE_ENV"; }

# Compose читает переменные для подстановки только из env-файлов, а секреты и
# текущий тег образа лежат раздельно. Обёртка нужна, чтобы ручные команды на
# сервере вели себя так же, как деплой: ./dc ps, ./dc logs -f app
dc() { docker compose --env-file ./.env --env-file "$IMAGE_ENV" "$@"; }

# Поднять стек с указанным образом. --wait ждёт HEALTHY, а не просто «запущен»:
# compose считает контейнер поднятым сразу, и без этого зелёным был бы даже
# crash loop.
bring_up() {
  IMAGE_REF="$1" dc up -d --wait --wait-timeout "$WAIT_TIMEOUT"
}

# Публичная проверка: и приложение живо, и Caddy с TLS работает.
verify() {
  local sha_seen ok_seen
  for _ in $(seq 1 20); do
    if body="$(curl -fsS --max-time 10 "https://${SITE_DOMAIN}/api/healthz" 2>/dev/null)"; then
      ok_seen="$(printf '%s' "$body" | sed -n 's/.*"ok":\([a-z]*\).*/\1/p')"
      sha_seen="$(printf '%s' "$body" | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p')"
      if [ "$ok_seen" = "true" ] && [ "$sha_seen" = "$EXPECTED_SHA" ]; then
        log "healthz: ok, sha=$sha_seen"
        return 0
      fi
      echo "  healthz пока не тот: ok=$ok_seen sha=$sha_seen (ждём $EXPECTED_SHA)"
    fi
    sleep 5
  done
  return 1
}

rollback() {
  if [ -z "$PREV_REF" ]; then
    log "Откатываться не на что (первый деплой). Стек остаётся в текущем состоянии."
    exit 1
  fi
  log "ОТКАТ на $PREV_REF"
  write_image_env "$PREV_REF"
  if bring_up "$PREV_REF"; then
    log "Откат выполнен. Прод на предыдущей версии."
  else
    log "ОТКАТ НЕ УДАЛСЯ — требуется ручное вмешательство."
  fi
  exit 1
}

log "Деплой $NEW_REF (ожидаемый sha $EXPECTED_SHA)"
[ -n "$PREV_REF" ] && echo "  предыдущий образ: $PREV_REF" || echo "  предыдущего образа нет — первый деплой"

log "Скачиваем образ"
docker pull "$NEW_REF" || rollback

log "Поднимаем стек"
write_image_env "$NEW_REF"
bring_up "$NEW_REF" || rollback

log "Проверяем https://${SITE_DOMAIN}/api/healthz"
verify || rollback

# Чистим только висячие слои. Предыдущий образ НЕ трогаем: это единственный
# быстрый путь отката, если проблема всплывёт уже после деплоя.
log "Убираем висячие слои"
docker image prune -f >/dev/null || true

log "Готово: прод на $NEW_REF"
