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
- **Старые посты (дозагрузка «ещё 10»)** — RSS отдаёт только свежий хвост, поэтому
  вглубь архива идём иначе: календарь `/YYYY/MM/` даёт список всех `ditemid` месяца
  (уходит в прошлое без ограничений, в отличие от `?skip=` с потолком ~400,
  `archive.ts`), а тело каждого старого поста берём из Atom
  `/data/atom/?itemid=<ditemid>` (полный HTML в `<content>`, как `<description>` в
  RSS; `atomItem.ts`). `scrapeOlder` идёт месяцами назад от самого старого
  сохранённого поста, пропуская уже имеющиеся `ditemid` (добор строго вглубь, без
  дублей и затирания). `scrapeNewer` — зеркало: идёт месяцами **вперёд** от самого
  свежего поста до текущего месяца, беря `ditemid` строго новее самого свежего
  (`id > maxId`), чтобы догнать блог, когда RSS-хвост уже устарел. Комментарии — тем
  же RPC, что и обычно.
- **Комментарии** — JSON-RPC `/__rpc_get_thread?journal=evo_lutio&itemid=<ditemid>&page=N`:
  массив `comments` с полями `dname` (автор), `article` (HTML), `ctime_ts` (дата),
  `level`/`parent` (вложенность). Пагинация по **15 верхнеуровневых веток на
  страницу** (`COMMENTS_PAGE_SIZE`); вложенные ответы идут целиком внутри своей
  ветки. Скрейпер выкачивает **все страницы** (цикл `page=1,2,…` до набора
  `replycount`, неполной страницы либо страницы без новых комментов; предохранитель
  `maxPages`). В метаданных RPC отдаёт только `replycount` — число страниц вычисляем
  сами. Комменты **дедуплицируются по `dtalkid`**: у некоторых постов ЖЖ повторно
  отдаёт уже виденные комменты на следующих страницах (когда `replycount` больше
  реального числа из-за удалённых) — без дедупа это давало бы дубли и
  `UNIQUE constraint failed` при вставке.

Скрейпер вежливый: кастомный `User-Agent` и паузы между запросами. Страницы
читаются из SQLite, ЖЖ на каждый просмотр не дёргается.

## Архитектура

- `server/db/` — SQLite через `better-sqlite3` (синхронный). `index.ts` —
  singleton-подключение, при старте применяет `schema.sql` (idempotent). Файл БД —
  `.data/blog.db` (в `.gitignore`). Таблицы: `posts`, `comments`, FTS5 `search`,
  плюс мелкий key-value `meta` (кэш, напр. общее число постов блога `blog_total`).
- **Поиск** — таблица FTS5 `search` с токенайзером `unicode61` (пословный поиск:
  целые слова, не подстроки; unicode-aware для кириллицы; без стеммера — формы
  слова не склеиваются). Наполняется из `posts`/`comments` при скрейпинге; запрос —
  `... WHERE search MATCH ? ORDER BY bm25(search)` (запрос оборачивается в фразу).
  `search.get.ts` возвращает дату каждого результата (`createdAt`: пост →
  `published_at`, коммент → `created_at`, считается в самом запросе) и поддерживает
  `?sort=relevance|date_desc|date_asc` — сортировка по релевантности либо по дате в
  обе стороны (по дате сортируются ВСЕ совпадения). Порог запроса — **2 символа**.
  `?cs=true` — **регистрозависимый** поиск: FTS всегда без регистра, поэтому кандидатов
  от MATCH до-фильтруем через `instr(content, q)` (побайтово). Результаты
  **пагинируются** (`?page=N`, 100 на страницу): ответ `{ query, page, totalPages, total, results }`,
  страница клампится на сервере (`Pagination.vue` на фронте) — жёсткого лимита в 50
  больше нет. В ссылку результата кладётся `&q=<слово>` для подсветки на странице.
  Смена токенайзера мигрируется автоматически: `useDb()` при старте видит старый
  trigram-индекс, дропает и пересобирает `search` из `posts`/`comments`
  (`rebuildSearchIndex`) — без обращения к ЖЖ.
- `server/utils/lj/` — скрейпер: `client.ts` (fetch+UA+паузы), `text.ts`
  (декод сущностей, HTML→текст, `extract`), `rss.ts` (свежий хвост: посты+тело),
  `archive.ts` (список `ditemid` месяца из `/YYYY/MM/`), `atomItem.ts` (тело поста
  по itemid из Atom), `comments.ts` (RPC), `scrape.ts` (оркестратор + upsert в БД +
  наполнение FTS; общий `createPersister` + `persistDitemids`, `scrape` — свежий
  хвост, `scrapeOlder`/`scrapeNewer` — дозагрузка старых/новых из архива,
  `scrapeMissing` — докачка пропущенных, дырки где угодно),
  `stats.ts` (`collectArchiveDitemids` — все id блога обходом архива; `countBlogPosts`
  поверх неё).
- **Полное число постов блога** — точного счётчика ЖЖ не отдаёт (профиль без
  числа, годовая `/YYYY/` — лишь календарь дней без ссылок на посты). Считаем
  обходом (`collectArchiveDitemids`): `/calendar` → годы (`fetchCalendarYears`),
  `/YYYY/` → непустые месяцы (`fetchYearMonths`, по ссылкам-дням), `/YYYY/MM/` →
  `ditemid` месяца; уникальные id в общий Set. ~150 запросов (последовательно, с
  паузами), поэтому — **по кнопке** и с кэшем в `meta` (`blog_total` + `blog_total_at`),
  не на каждый просмотр.
- **Докачка пропущенных (`scrapeMissing`):** `collectArchiveDitemids` (все id блога)
  минус уже сохранённые → качаем недостающие. Закрывает дырки **в любом месте**, в
  т.ч. в середине (куда `scrapeOlder`/`scrapeNewer` не дотягиваются — они ходят только
  за границы). Стрим добавляет фазу `{type:'scan',done,total}` (обход архива по годам)
  до `start` — фронт показывает «Сканируем архив: X/Y лет».
- **Прогресс скрейпа (стриминг):** эндпоинты скрейпа отдают не разовый JSON, а
  поток **NDJSON** (`server/utils/stream.ts`): `{type:'start',total}` → на каждый
  сохранённый пост `{type:'progress',done,total}` → `{type:'done',posts,comments}`
  (ошибка — `{type:'error',message}`). Наружу это идёт через `ProgressOpts`
  (`onStart`/`onProgress`) в `scrape`/`scrapeOlder`/`scrapeNewer`. Фронт
  (`index.vue`) читает поток `fetch`-ридером и рисует полосу «done/total».
- **Агрессивный режим (`aggressive`):** галочка на фронте → `{ aggressive:true }` в
  теле любого scrape-эндпоинта → `ScrapeOpts.aggressive`. Отключает вежливые паузы
  (`sleep`) и качает посты **пулом параллельно** (`AGGRESSIVE_CONCURRENCY`, сейчас 6;
  `runPool` в `scrape.ts`; `fetchAllComments` тоже без пауз). Быстрее, но жёстче к
  ЖЖ — риск троттлинга/бана, поэтому только по явному запросу. По умолчанию выключен
  (последовательно, с паузами).
- `server/api/` — Nitro routes: `scrape.post.ts` (свежий хвост, `{ limit? }` 1..25),
  `scrape/more.post.ts` (дозагрузка старых, `{ count? }` ≥1 без потолка → `scrapeOlder`),
  `scrape/newer.post.ts` (дозагрузка новых, `{ count? }` ≥1 без потолка → `scrapeNewer`),
  `scrape/missing.post.ts` (докачать пропущенные, `{ aggressive? }` → `scrapeMissing`),
  `blog-stats.get.ts` (сохранено + кэш общего числа) / `blog-stats.post.ts`
  (пересчёт `countBlogPosts` → кэш в `meta`),
  `posts.get.ts?page=N` (страница списка постов, 10 на страницу, ответ
  `{ page, totalPages, total, posts }`), `posts/[id].get.ts` (мета + счётчик
  комментов), `posts/[id]/comments.get.ts?page=N` (страница комментов +
  `totalPages`), `search.get.ts` (для комментов вычисляет страницу пагинации →
  ссылка `?page=N#c<id>`).
- **Пагинация комментов из БД:** ветка со всеми ответами лежит в pre-order
  сплошным блоком по `position`, поэтому страница = диапазон позиций между началами
  N-й и (N+1)-й верхнеуровневых веток (без пересборки дерева на сервере).
- `app/` — фронт (Nuxt srcDir): `pages/index.vue`, `pages/posts/[id].vue`,
  `components/CommentTree.vue` (рекурсивное дерево комментов из плоского списка).
- **Размеры картинок (против layout shift):** контент-картинки ЖЖ приходят без
  `width`/`height`. `server/utils/lj/images.ts` (`reserveImgSpace`) добывает размеры
  через Range-запрос заголовка (`image-size`) и вписывает `width`/`height` +
  `loading="lazy"`/`decoding="async"` в HTML. Пробинг делается **на скрейпе**
  (`savePost` в `scrape.ts`) — размеры сразу ложатся в `body_html` постов и комментов
  в БД, а read-эндпоинты (`posts/[id]`, `.../comments`) отдают HTML **как есть**, ЖЖ
  на просмотр не дёргают. Пробинг на сервере (браузеру мешает CORS), с кэшем размеров
  в памяти процесса; идемпотентен — повторный скрейп не портит уже вписанное. Иконки
  `<lj user>` (`l-stat.livejournal.net`) не пробятся — их размер задаёт CSS
  (`.i-ljuser-userhead`).

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
