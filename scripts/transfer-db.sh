#!/usr/bin/env bash
# Перенести локальную БД на ВМ (разовая операция при первом развёртывании).
#
#   ./scripts/transfer-db.sh ubuntu@1.2.3.4 [путь-к-локальной-БД]
#
# Простое копирование живого файла ненадёжно из-за WAL, поэтому снимок делается
# через SQLite Backup API, целостность проверяется с обеих сторон, а подмена на
# ВМ выполняется атомарным mv при остановленном приложении. Старая база
# сохраняется как .prev до успешного healthcheck.

set -euo pipefail

TARGET="${1:?укажите цель: user@host}"
DB="${2:-.data/blog.db}"
REMOTE_DIR=/srv/evo/data
# UID/GID пользователя app из образа: под ним контейнер пишет -wal и -shm.
APP_UID=10001

[ -f "$DB" ] || { echo "Нет файла БД: $DB" >&2; exit 1; }

sha() { command -v sha256sum >/dev/null && sha256sum "$1" | cut -d' ' -f1 || shasum -a 256 "$1" | cut -d' ' -f1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
SNAP="$WORK/blog.db"

echo "▶ Снимок (Backup API, а не копия файла)…"
sqlite3 "$DB" ".backup '$SNAP'"

echo "▶ Проверка целостности локально…"
RESULT=$(sqlite3 "$SNAP" "PRAGMA integrity_check;")
[ "$RESULT" = "ok" ] || { echo "integrity_check: $RESULT" >&2; exit 1; }
echo "  ok, постов: $(sqlite3 "$SNAP" 'SELECT count(*) FROM posts;')"

echo "▶ Сжатие…"
gzip -1 "$SNAP"
SUM=$(sha "$SNAP.gz")
echo "  $(du -h "$SNAP.gz" | cut -f1), sha256 $SUM"

echo "▶ Передача на $TARGET…"
scp "$SNAP.gz" "$TARGET:/tmp/blog.db.gz"

echo "▶ Установка на ВМ…"
ssh "$TARGET" APP_UID="$APP_UID" REMOTE_DIR="$REMOTE_DIR" SUM="$SUM" 'bash -euo pipefail -s' <<'REMOTE'
  cd /tmp
  echo "  сверка контрольной суммы…"
  echo "$SUM  blog.db.gz" | sha256sum -c - >/dev/null

  sudo mkdir -p "$REMOTE_DIR"
  # Распаковываем во ВРЕМЕННОЕ имя в целевом каталоге: тогда финальный mv
  # заведомо в пределах одной файловой системы, то есть атомарен.
  echo "  распаковка…"
  gunzip -c blog.db.gz | sudo tee "$REMOTE_DIR/blog.db.incoming" >/dev/null

  echo "  проверка целостности на ВМ…"
  RESULT=$(sudo sqlite3 "$REMOTE_DIR/blog.db.incoming" "PRAGMA integrity_check;")
  [ "$RESULT" = "ok" ] || { echo "integrity_check на ВМ: $RESULT" >&2; exit 1; }

  echo "  остановка приложения…"
  if [ -f /srv/evo/docker-compose.yml ]; then
    (cd /srv/evo && sudo docker compose stop app || true)
  fi

  # Старые -wal/-shm относятся к СТАРОЙ базе. Если их не убрать, SQLite попытается
  # применить их к новому файлу — это порча данных.
  echo "  подмена…"
  [ -f "$REMOTE_DIR/blog.db" ] && sudo mv "$REMOTE_DIR/blog.db" "$REMOTE_DIR/blog.db.prev"
  sudo rm -f "$REMOTE_DIR/blog.db-wal" "$REMOTE_DIR/blog.db-shm"
  sudo mv "$REMOTE_DIR/blog.db.incoming" "$REMOTE_DIR/blog.db"
  sudo chown -R "$APP_UID:$APP_UID" "$REMOTE_DIR"

  rm -f blog.db.gz
  echo "  готово. Старая база (если была) сохранена как blog.db.prev"
REMOTE

echo
echo "▶ Готово. Поднимите приложение и проверьте healthz:"
echo "    ssh $TARGET 'cd /srv/evo && docker compose up -d --wait'"
echo "    curl -s https://<домен>/api/healthz"
echo "  Убедившись, что всё в порядке, удалите $REMOTE_DIR/blog.db.prev"
