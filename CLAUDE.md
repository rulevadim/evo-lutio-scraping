# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Обзор

Учебный full-stack пет-проект на **Nuxt 4**: скрейпит блог Эволюции
(https://evo-lutio.livejournal.com/), складывает контент в локальную SQLite и
показывает его в собственной простой вёрстке — список 10 последних постов,
страница поста с комментариями и полнотекстовый поиск по всему сохранённому
контенту (тело поста + любой комментарий).

Бэкенд отдельным сервисом не выделен: вся серверная логика — в Nitro (встроенный
сервер Nuxt) под `server/`.

## Команды

Пакетный менеджер — **pnpm**.

- `pnpm dev` — дев-сервер Nuxt (http://localhost:3000)
- `pnpm build` — прод-сборка (Nitro), `pnpm preview` — просмотр сборки
- `pnpm generate` — статическая генерация
- `npx nuxt prepare` — перегенерировать типы/`.nuxt` (запускается и как postinstall)
- Запустить скрейпинг (наполнить БД): `curl -X POST localhost:3000/api/scrape`

Отдельного тест-раннера нет. Типы проверяются Nuxt/Vue при сборке.

## Источник данных (LiveJournal)

Механика скрейпинга (проверена live-запросами, см. `server/utils/lj/`):

- **Список постов + тело** — RSS `/data/rss`: последние ~25 постов (берём 10),
  пермалинки вида `/<ditemid>.html`, заголовок, дата и **полный HTML статьи прямо
  в `<description>`** (с картинками). Поэтому отдельные страницы постов не парсим.
- **Комментарии** — JSON-RPC `/__rpc_get_thread?journal=evo_lutio&itemid=<ditemid>&page=N`:
  массив `comments` с полями `dname` (автор), `article` (HTML), `ctime_ts` (дата),
  `level`/`parent` (вложенность). Пагинация по **15 верхнеуровневых веток на
  страницу** (`COMMENTS_PAGE_SIZE`); вложенные ответы идут целиком внутри своей
  ветки. Скрейпер выкачивает **все страницы** (цикл `page=1,2,…` до набора
  `replycount` либо неполной страницы; предохранитель `maxPages`). В метаданных
  RPC отдаёт только `replycount` — число страниц вычисляем сами.

Скрейпер вежливый: кастомный `User-Agent` и паузы между запросами. Страницы
читаются из SQLite, ЖЖ на каждый просмотр не дёргается.

## Архитектура

- `server/db/` — SQLite через `better-sqlite3` (синхронный). `index.ts` —
  singleton-подключение, при старте применяет `schema.sql` (idempotent). Файл БД —
  `.data/blog.db` (в `.gitignore`).
- **Поиск** — таблица FTS5 `search` с токенайзером `unicode61` (пословный поиск:
  целые слова, не подстроки; unicode-aware для кириллицы; без стеммера — формы
  слова не склеиваются). Наполняется из `posts`/`comments` при скрейпинге; запрос —
  `... WHERE search MATCH ? ORDER BY bm25(search)` (запрос оборачивается в фразу).
  `search.get.ts` кладёт в ссылку результата `&q=<слово>` для подсветки на странице.
  Смена токенайзера мигрируется автоматически: `useDb()` при старте видит старый
  trigram-индекс, дропает и пересобирает `search` из `posts`/`comments`
  (`rebuildSearchIndex`) — без обращения к ЖЖ.
- `server/utils/lj/` — скрейпер: `client.ts` (fetch+UA+паузы), `text.ts`
  (декод сущностей, HTML→текст), `rss.ts` (посты+тело), `comments.ts` (RPC),
  `scrape.ts` (оркестратор + upsert в БД + наполнение FTS).
- `server/api/` — Nitro routes: `scrape.post.ts`, `posts.get.ts`,
  `posts/[id].get.ts` (мета + счётчик комментов),
  `posts/[id]/comments.get.ts?page=N` (страница комментов + `totalPages`),
  `search.get.ts` (для комментов вычисляет страницу пагинации → ссылка `?page=N#c<id>`).
- **Пагинация комментов из БД:** ветка со всеми ответами лежит в pre-order
  сплошным блоком по `position`, поэтому страница = диапазон позиций между началами
  N-й и (N+1)-й верхнеуровневых веток (без пересборки дерева на сервере).
- `app/` — фронт (Nuxt srcDir): `pages/index.vue`, `pages/posts/[id].vue`,
  `components/CommentTree.vue` (рекурсивное дерево комментов из плоского списка).

Важно про структуру Nuxt 4: `srcDir` = `app/` (алиасы `~`/`@` указывают туда),
а `server/` лежит в **корне** проекта, не внутри `app/`.

## Наблюдение за запросами

- **Слой `/api/*`** (браузер → наш сервер): browser DevTools → Network, либо Nuxt
  DevTools (`Shift+Option+D` → вкладка Server Routes).
- **Исходящие к ЖЖ** (наш сервер → LiveJournal, т.е. сам скрейпинг) — не видны в
  браузере. Плагин `server/plugins/http-observability.ts` (Nitro) даёт два режима
  через env:
  - `HTTP_DEBUG=1 pnpm dev` (или `pnpm dev:debug`) — лог каждого fetch в терминал
    (`[http →] …` / `[http ←] статус …`) через `node:diagnostics_channel` (каналы undici).
  - `HTTPS_PROXY=http://127.0.0.1:9090 pnpm dev` — прогон трафика через
    **Proxyman/mitmproxy** (Node'овый fetch не уважает `HTTP_PROXY` сам, поэтому
    ставим `ProxyAgent` из undici через `setGlobalDispatcher`). Для TLS-перехвата
    Proxyman нужно доверять его CA: `NODE_EXTRA_CA_CERTS=<proxyman-ca.pem>`, либо
    быстрый дев-обход `HTTP_PROXY_INSECURE=1` (без проверки TLS).

Важно: `undici` закреплён на `^6` — 8.x несовместим с Node 20 (падает
`webidl.util.markAsUncloneable is not a function`).

## Стили

Два движка утилит подключены одновременно — это намеренно:

- **Tailwind CSS v4** — основной и единственный слой вёрстки. Подключён через
  `@tailwindcss/vite` (плагин в `nuxt.config.ts` → `vite.plugins`) и
  `app/assets/css/main.css` (`@import "tailwindcss";`). **Всю разметку делаем на нём.**
- **UnoCSS** (`@unocss/nuxt` + `uno.config.ts`) — стоит «на поиграться потом»,
  preflight выключен во избежание конфликта со сбросом Tailwind. В разметке пока
  не используется.
