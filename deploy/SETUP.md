# Развёртывание на ВМ Cloud.ru

Порядок разовый: дальше всё катится само по пушу в `main`.
Инструкция подходит и для любого другого VPS с Ubuntu — меняется только шаг 1.

## 1. Виртуальная машина

Консоль Cloud.ru → **Evolution Compute → создать ВМ**:

- конфигурация **free tier**: 2 vCPU / 4 ГБ RAM / 30 ГБ SSD NVMe
- образ **Ubuntu 24.04 LTS** (не 20.04 — он вне основной поддержки с мая 2025)
- SSH-ключ — свой публичный
- **публичный IP** — арендовать и привязать (оплачивается отдельно, ~147₽/мес;
  без него сайт снаружи недоступен)

**Группа безопасности** — входящие: 22 (SSH), 80 и 443 (HTTP/HTTPS).

Про free tier: он отключается при простое 60 дней, приостанавливается при 90 и
удаляется при 180. Удаление ВМ уничтожает и загрузочный диск — поэтому бэкап
(шаг 8) настраивается до боевой эксплуатации, а не когда-нибудь потом.

## 2. Базовая настройка

```bash
ssh <user>@<IP>

uname -m            # ожидаем x86_64; если aarch64 — в workflow нужен platforms: linux/arm64
sudo ufw status     # группа безопасности Cloud.ru не отменяет локальный firewall
```

Если `ufw` активен:

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

Docker — из официального репозитория (convenience-скрипт `get.docker.com` для
прода не рекомендуется самим Docker):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl sqlite3
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Перелогиниться, чтобы группа применилась.

> **Честно про права.** Членство в группе `docker` равносильно root на этой
> машине: из контейнера можно смонтировать корень файловой системы. Ограничение
> каталогом ничего не даёт. Значит, приватный ключ деплоя = root-ключ, и
> хранить его надо соответственно (GitHub Environment `production`, отдельная
> пара ключей только для деплоя). Альтернативы, если это неприемлемо: rootless
> Docker либо root-owned wrapper с жёсткой валидацией аргументов.

Ужесточить SSH (`/etc/ssh/sshd_config`): `PasswordAuthentication no`,
`PermitRootLogin no`, затем `sudo systemctl restart ssh`.

Ограничивать SSH по IP **нельзя**: раннеры GitHub приходят с динамических
адресов, и сам GitHub не рекомендует их вносить в allowlist.

## 3. Каталоги и секреты

```bash
sudo mkdir -p /srv/evo/data
sudo chown -R $USER:$USER /srv/evo
# 10001 — UID пользователя app в образе, под ним контейнер пишет -wal и -shm
sudo chown -R 10001:10001 /srv/evo/data
```

Создать `/srv/evo/.env` (в git его нет и быть не должно):

```bash
cat > /srv/evo/.env <<EOF
SITE_DOMAIN=<IP-с-дефисами>.nip.io
NUXT_ADMIN_PASSWORD=<свой пароль>
NUXT_SESSION_PASSWORD=$(openssl rand -base64 32)
EOF
chmod 600 /srv/evo/.env
```

`nip.io` резолвится в IP без регистрации домена: для `185.1.2.3` это
`185-1-2-3.nip.io`. Let's Encrypt выдаёт на такое имя сертификат. Свой домен
подставляется сюда же — достаточно A-записи на IP.

HTTPS обязателен: без него пароль админа идёт по сети открытым текстом.

## 4. Репозиторий GitHub

Локально, из корня проекта:

```bash
gh repo create evo-lutio-scraping --public --source=. --push
```

Секреты в **Settings → Environments → production**:

| Секрет | Значение |
|---|---|
| `SSH_HOST` | публичный IP ВМ |
| `SSH_USER` | имя пользователя ВМ (задаётся при создании) |
| `SSH_KEY` | приватный ключ деплой-пары (целиком, с заголовками) |

`NUXT_ADMIN_PASSWORD` и `NUXT_SESSION_PASSWORD` в GitHub **не нужны** — они
живут только в `/srv/evo/.env` на ВМ.

## 5. Bootstrap GHCR

Новый пакет в GHCR создаётся **приватным**, а `docker pull` на ВМ ходит
анонимно — поэтому первый деплой без этого шага гарантированно упадёт.

1. Actions → «Сборка и деплой» → **Run workflow**, снять галочку *deploy*.
   Прогон соберёт и запушит образ, не трогая сервер.
2. GitHub → Packages → `evo-lutio-scraping` → Package settings →
   **Change visibility → Public**.
3. Запустить workflow ещё раз, уже с галочкой (или просто запушить в `main`).

## 6. Перенос базы

С локальной машины (dev-сервер предварительно остановить):

```bash
./scripts/transfer-db.sh <user>@<IP>
```

Скрипт делает снимок через SQLite Backup API, проверяет `integrity_check` с
обеих сторон, сверяет sha256 после передачи, атомарно подменяет файл и
сохраняет старую базу как `blog.db.prev`.

## 7. Первый запуск и проверка

```bash
curl -s https://<домен>/api/healthz          # ожидаем ok:true и верный sha
curl -s "https://<домен>/api/posts?page=1"   # список постов
```

Что проверить руками:

- главная открывается, поиск по русскому слову возвращает результаты;
- у анонима нет кнопок скрейпинга, `POST /api/scrape` даёт 401;
- вход на `/admin`, скрейп идёт **инкрементально** (полоса прогресса движется —
  это проверка того, что Caddy не буферизует NDJSON);
- `./dc restart app` → данные на месте.

## 8. Бэкапы

Поставить `awscli`, создать бакет в Cloud.ru Object Storage (15 ГБ бесплатно) и
сервисный ключ с правами только на него.

```bash
sudo apt-get install -y awscli
cat > /srv/evo/backup.env <<'EOF'
S3_ENDPOINT=https://s3.cloud.ru
S3_BUCKET=<имя бакета>
AWS_ACCESS_KEY_ID=<...>
AWS_SECRET_ACCESS_KEY=<...>
AWS_DEFAULT_REGION=ru-central-1
KEEP_DAILY=7
EOF
chmod 600 /srv/evo/backup.env

sudo cp /srv/evo/evo-backup.service /srv/evo/evo-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now evo-backup.timer
sudo systemctl start evo-backup.service   # разовый прогон
```

**Обязательно сделать restore drill**: скачать свежий бэкап, распаковать
локально, проверить `PRAGMA integrity_check` и что поиск работает. Непроверенный
бэкап бэкапом не является.

Архив ~231 МБ, в 15 ГБ помещается около 65 копий; `KEEP_DAILY` задаёт, сколько
реально хранить.

## Эксплуатация

```bash
cd /srv/evo
./dc ps
./dc logs -f app
./deploy.sh ghcr.io/<user>/evo-lutio-scraping:<sha> <sha>   # ручной деплой/откат
df -h                                                       # диска всего 30 ГБ
```

Откат на предыдущую версию — тот же `deploy.sh` с прежним SHA: старый образ
намеренно не удаляется после успешного деплоя.

## Расхождение прод и локальной базы

Диск персистентный, поэтому скрейпить можно прямо в проде через админку — ради
этого и делался вход по паролю. Следствие: локальная база перестаёт быть
источником истины. Чтобы подтянуть её к проду, скачайте бэкап из хранилища.
