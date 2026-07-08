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
- **Комментарии** — JSON-RPC `/__rpc_get_thread?journal=evo_lutio&itemid=<ditemid>`:
  массив `comments` с полями `dname` (автор), `article` (HTML), `ctime_ts` (дата),
  `level`/`parent` (вложенность). Отдаётся страницами — берём **только первую**
  (топ-N веток), чтобы не упереться в тысячи запросов и rate-limit.

Скрейпер вежливый: кастомный `User-Agent` и паузы между запросами. Страницы
читаются из SQLite, ЖЖ на каждый просмотр не дёргается.

## Архитектура

- `server/db/` — SQLite через `better-sqlite3` (синхронный). `index.ts` —
  singleton-подключение, при старте применяет `schema.sql` (idempotent). Файл БД —
  `.data/blog.db` (в `.gitignore`).
- **Поиск** — таблица FTS5 `search` с токенайзером `trigram` (поиск по подстрокам,
  работает для русского без стеммера). Наполняется из `posts` и `comments` при
  скрейпинге; запрос — `... WHERE search MATCH ? ORDER BY bm25(search)`.
- `server/utils/lj/` — скрейпер: `client.ts` (fetch+UA+паузы), `text.ts`
  (декод сущностей, HTML→текст), `rss.ts` (посты+тело), `comments.ts` (RPC),
  `scrape.ts` (оркестратор + upsert в БД + наполнение FTS).
- `server/api/` — Nitro routes: `scrape.post.ts`, `posts.get.ts`,
  `posts/[id].get.ts`, `search.get.ts`.
- `app/` — фронт (Nuxt srcDir): `pages/index.vue`, `pages/posts/[id].vue`,
  `components/CommentTree.vue` (рекурсивное дерево комментов из плоского списка).

Важно про структуру Nuxt 4: `srcDir` = `app/` (алиасы `~`/`@` указывают туда),
а `server/` лежит в **корне** проекта, не внутри `app/`.

## Стили

Два движка утилит подключены одновременно — это намеренно:

- **Tailwind CSS v4** — основной и единственный слой вёрстки. Подключён через
  `@tailwindcss/vite` (плагин в `nuxt.config.ts` → `vite.plugins`) и
  `app/assets/css/main.css` (`@import "tailwindcss";`). **Всю разметку делаем на нём.**
- **UnoCSS** (`@unocss/nuxt` + `uno.config.ts`) — стоит «на поиграться потом»,
  preflight выключен во избежание конфликта со сбросом Tailwind. В разметке пока
  не используется.
