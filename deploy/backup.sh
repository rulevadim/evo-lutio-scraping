#!/usr/bin/env bash
# Бэкап боевой БД в объектное хранилище.
#
# Простое копирование файла при живых записях ненадёжно (WAL), поэтому снимок
# делается через SQLite Backup API (`.backup`), затем проверяется integrity_check
# и сверяется контрольная сумма после загрузки. Непроверенный бэкап бэкапом не
# является.
#
# Настройки — в /srv/evo/backup.env:
#   S3_ENDPOINT=https://s3.cloud.ru
#   S3_BUCKET=evo-backups
#   AWS_ACCESS_KEY_ID=...
#   AWS_SECRET_ACCESS_KEY=...
#   AWS_DEFAULT_REGION=ru-central-1
#   KEEP_DAILY=7
#
# Запускается systemd-таймером (evo-backup.timer). Ошибка таймера должна быть
# заметна: см. OnFailure в evo-backup.service.

set -euo pipefail

DB=${DB:-/srv/evo/data/blog.db}
WORK=$(mktemp -d)
# Временные файлы убираются в любом случае, включая аварийный выход.
trap 'rm -rf "$WORK"' EXIT

# shellcheck disable=SC1091
. /srv/evo/backup.env
: "${S3_ENDPOINT:?}" "${S3_BUCKET:?}"
KEEP_DAILY=${KEEP_DAILY:-7}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SNAP="$WORK/blog-$STAMP.db"
ARCHIVE="$SNAP.gz"

# Места должно хватить на снимок и на архив.
NEED=$(( $(stat -c %s "$DB") * 3 / 2 ))
FREE=$(df -B1 --output=avail "$WORK" | tail -1)
if [ "$FREE" -lt "$NEED" ]; then
  echo "Мало места: нужно ~$((NEED/1024/1024)) МБ, свободно $((FREE/1024/1024)) МБ" >&2
  exit 1
fi

echo "Снимок…"
sqlite3 "$DB" ".backup '$SNAP'"

echo "Проверка целостности…"
RESULT=$(sqlite3 "$SNAP" "PRAGMA integrity_check;")
[ "$RESULT" = "ok" ] || { echo "integrity_check: $RESULT" >&2; exit 1; }

echo "Сжатие…"
gzip -1 "$SNAP"
LOCAL_SUM=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)

KEY="blog/$(basename "$ARCHIVE")"
echo "Загрузка s3://$S3_BUCKET/$KEY …"
aws --endpoint-url "$S3_ENDPOINT" s3 cp "$ARCHIVE" "s3://$S3_BUCKET/$KEY"

# Сверяем то, что реально легло в хранилище: молчаливо битая копия хуже, чем её
# отсутствие, потому что создаёт ложное чувство защищённости.
echo "Сверка контрольной суммы…"
aws --endpoint-url "$S3_ENDPOINT" s3 cp "s3://$S3_BUCKET/$KEY" "$WORK/verify.gz" >/dev/null
REMOTE_SUM=$(sha256sum "$WORK/verify.gz" | cut -d' ' -f1)
[ "$LOCAL_SUM" = "$REMOTE_SUM" ] || { echo "Контрольные суммы разошлись" >&2; exit 1; }

echo "Ротация: оставляем последние $KEEP_DAILY"
aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET/blog/" \
  | awk '{print $4}' | sort | head -n "-$KEEP_DAILY" \
  | while read -r old; do
      [ -n "$old" ] && aws --endpoint-url "$S3_ENDPOINT" s3 rm "s3://$S3_BUCKET/blog/$old"
    done

echo "Готово: $KEY ($(du -h "$ARCHIVE" | cut -f1)), sha256 $LOCAL_SUM"
