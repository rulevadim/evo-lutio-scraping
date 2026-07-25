import { useDb } from '../../db'
import { fetchMonthDitemids } from './archive'
import { fetchPostByItemid } from './atomItem'
import { sleep } from './client'
import type { LjComment } from './comments'
import { fetchAllComments } from './comments'
import { reserveImgSpace } from './images'
import type { RssPost } from './rss'
import { fetchRecentPosts } from './rss'
import { collectArchiveDitemids } from './stats'
import { htmlToText } from './text'

export interface ScrapeResult {
  posts: number
  comments: number
}

/**
 * Колбэки прогресса для стриминга наружу: `onStart` — когда известно, сколько
 * постов будет сохранено; `onProgress` — после каждого сохранённого поста.
 */
export interface ProgressOpts {
  onStart?: (total: number) => void
  onProgress?: (done: number, total: number) => void
}

/**
 * Опции скрейпа. `aggressive` — «агрессивный» режим: без вежливых пауз и с
 * параллельной выкачкой постов пулом. Быстрее, но заметно жёстче к ЖЖ (риск
 * троттлинга/бана), поэтому включается только по явному запросу с фронта.
 */
export interface ScrapeOpts extends ProgressOpts {
  aggressive?: boolean
}

// Сколько постов качать одновременно в агрессивном режиме.
const AGGRESSIVE_CONCURRENCY = 6

/** Прогнать items через worker с ограничением на одновременность. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]!)
  })
  await Promise.all(runners)
}

type Db = ReturnType<typeof useDb>

/**
 * Фабрика «сохранятеля» поста: готовит prepared statements один раз и возвращает
 * функцию, которая в одной транзакции делает upsert поста и полную пересборку его
 * комментариев и FTS-индекса. Идемпотентно по `id` (перезапись). Общий код для
 * скрейпа свежего хвоста ({@link scrape}) и дозагрузки архива ({@link scrapeOlder}).
 */
function createPersister(db: Db) {
  const upsertPost = db.prepare(`
    INSERT INTO posts (id, url, title, published_at, tags, body_html, scraped_at)
    VALUES (@id, @url, @title, @published_at, @tags, @body_html, @scraped_at)
    ON CONFLICT(id) DO UPDATE SET
      url = @url, title = @title, published_at = @published_at,
      tags = @tags, body_html = @body_html, scraped_at = @scraped_at
  `)
  const delComments = db.prepare('DELETE FROM comments WHERE post_id = ?')
  const insComment = db.prepare(`
    INSERT INTO comments (id, post_id, parent_id, level, author, author_journal, body_html, created_at, position)
    VALUES (@id, @post_id, @parent_id, @level, @author, @author_journal, @body_html, @created_at, @position)
  `)
  const delSearch = db.prepare('DELETE FROM search WHERE post_id = ?')
  const insSearch = db.prepare(`
    INSERT INTO search (kind, post_id, ref_id, title, author, content)
    VALUES (@kind, @post_id, @ref_id, @title, @author, @content)
  `)

  const save = db.transaction((post: RssPost, comments: LjComment[]) => {
    const now = Math.floor(Date.now() / 1000)

    upsertPost.run({
      id: post.id,
      url: post.url,
      title: post.title,
      published_at: post.publishedAt,
      tags: JSON.stringify(post.tags),
      body_html: post.bodyHtml,
      scraped_at: now,
    })
    delComments.run(post.id)
    delSearch.run(post.id)

    insSearch.run({
      kind: 'post',
      post_id: post.id,
      ref_id: post.id,
      title: post.title,
      author: '',
      content: htmlToText(post.bodyHtml),
    })

    for (const c of comments) {
      insComment.run({
        id: c.id,
        post_id: post.id,
        parent_id: c.parentId,
        level: c.level,
        author: c.author,
        author_journal: c.authorJournal,
        body_html: c.bodyHtml,
        created_at: c.createdAt,
        position: c.position,
      })
      insSearch.run({
        kind: 'comment',
        post_id: post.id,
        ref_id: c.id,
        title: '',
        author: c.author,
        content: htmlToText(c.bodyHtml),
      })
    }
  })

  return (post: RssPost, comments: LjComment[]) => save(post, comments)
}

type Persister = ReturnType<typeof createPersister>

/**
 * Пробить размеры контент-картинок и вписать их (width/height + lazy) в HTML поста
 * и комментариев, затем persist. Пробинг делаем здесь, на скрейпе (async), чтобы в
 * БД лёг уже готовый HTML — read-эндпоинты ЖЖ на просмотр не дёргают. Возвращает
 * число комментариев.
 */
async function savePost(persist: Persister, post: RssPost, comments: LjComment[]): Promise<number> {
  const bodyHtml = await reserveImgSpace(post.bodyHtml)
  const baked = await Promise.all(
    comments.map(async (c) => ({ ...c, bodyHtml: await reserveImgSpace(c.bodyHtml) })),
  )
  persist({ ...post, bodyHtml }, baked)
  return comments.length
}

/**
 * По списку `ditemid`: тело из Atom + все комментарии → persist. Общий «хвост»
 * дозагрузки для {@link scrapeOlder} и {@link scrapeNewer}.
 */
async function persistDitemids(
  persist: Persister,
  ids: number[],
  opts: ScrapeOpts = {},
): Promise<ScrapeResult> {
  opts.onStart?.(ids.length)
  let commentCount = 0
  let done = 0

  const handle = async (id: number) => {
    const post = await fetchPostByItemid(id)
    const comments = await fetchAllComments(id, { aggressive: opts.aggressive })
    commentCount += await savePost(persist, post, comments)
    opts.onProgress?.(++done, ids.length)
  }

  if (opts.aggressive) {
    // Без пауз, посты качаем пулом параллельно.
    await runPool(ids, AGGRESSIVE_CONCURRENCY, handle)
  } else {
    for (const id of ids) {
      await handle(id)
      await sleep(600) // вежливая пауза между постами
    }
  }
  return { posts: ids.length, comments: commentCount }
}

/**
 * Оркестратор скрейпинга: RSS → по каждому посту тянем комментарии → upsert в БД
 * и пере-наполнение полнотекстового индекса. Идемпотентно (перезапись по id).
 */
export async function scrape(limit = 10, opts: ScrapeOpts = {}): Promise<ScrapeResult> {
  const db = useDb()
  const persist = createPersister(db)

  const posts = await fetchRecentPosts(limit)
  opts.onStart?.(posts.length)
  let commentCount = 0
  let done = 0

  const handle = async (post: RssPost) => {
    const comments = await fetchAllComments(post.id, { aggressive: opts.aggressive })
    commentCount += await savePost(persist, post, comments)
    opts.onProgress?.(++done, posts.length)
  }

  if (opts.aggressive) {
    await runPool(posts, AGGRESSIVE_CONCURRENCY, handle)
  } else {
    for (const post of posts) {
      await handle(post)
      await sleep(600) // вежливая пауза между постами
    }
  }

  return { posts: posts.length, comments: commentCount }
}

/**
 * Инкрементальная дозагрузка: добираем `count` постов **старше** самого старого
 * уже сохранённого. Каталог ditemid берём из календарного архива `/YYYY/MM/`, идя
 * месяцами назад от месяца самого старого поста (при пустой БД — от текущего),
 * и **отбрасываем уже сохранённые id** — поэтому добор идёт строго вглубь без
 * пропусков и без затирания имеющихся записей. Тело каждого поста — из Atom по
 * itemid, комментарии — как обычно. Обход прекращается, когда набрали `count`,
 * либо после года подряд пустых месяцев (значит, дошли до начала журнала);
 * `maxMonths` — жёсткий предохранитель сверху.
 */
export async function scrapeOlder(
  count = 10,
  opts: { maxMonths?: number } & ScrapeOpts = {},
): Promise<ScrapeResult> {
  const db = useDb()
  const persist = createPersister(db)
  const maxMonths = opts.maxMonths ?? 300

  const existing = new Set<number>(
    (db.prepare('SELECT id FROM posts').all() as { id: number }[]).map((r) => r.id),
  )
  const oldest = db
    .prepare('SELECT published_at FROM posts ORDER BY published_at ASC LIMIT 1')
    .get() as { published_at: number } | undefined

  // Стартовый месяц (UTC): месяц самого старого поста, либо текущий при пустой БД.
  const start = oldest ? new Date(oldest.published_at * 1000) : new Date()
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth() + 1 // 1..12

  // Собираем до `count` новых ditemid, идя месяцами назад.
  const picked: number[] = []
  let emptyStreak = 0 // подряд идущие пустые месяцы → добрались до начала журнала
  for (let i = 0; i < maxMonths && picked.length < count; i++) {
    let ids: number[] = []
    try {
      ids = await fetchMonthDitemids(year, month)
    } catch (err) {
      // Пустой/недоступный месяц архива не должен ронять весь батч — пропускаем.
      console.warn(`[scrapeOlder] пропуск ${year}/${month}:`, (err as Error).message)
    }
    emptyStreak = ids.length === 0 ? emptyStreak + 1 : 0
    if (emptyStreak >= 12) break // год пустых месяцев подряд — постов старше уже нет

    for (const id of ids) {
      if (picked.length >= count) break
      if (!existing.has(id)) {
        picked.push(id)
        existing.add(id)
      }
    }

    // Предыдущий месяц.
    month--
    if (month === 0) {
      month = 12
      year--
    }
    if (picked.length < count && !opts.aggressive) await sleep(600) // вежливая пауза
  }

  return await persistDitemids(persist, picked, opts)
}

/**
 * Инкрементальная дозагрузка: добираем `count` постов **новее** самого свежего
 * уже сохранённого (зеркало {@link scrapeOlder}). Идём месяцами **вперёд** от
 * месяца самого свежего поста до текущего, берём из каталога `ditemid` строго
 * новее самого свежего (`id > maxId`, ditemid монотонен) и ещё не сохранённые, по
 * возрастанию — добор идёт вплотную вперёд, без пропусков и затирания. За текущий
 * месяц не выходим (будущего нет); `maxMonths` — предохранитель.
 */
export async function scrapeNewer(
  count = 10,
  opts: { maxMonths?: number } & ScrapeOpts = {},
): Promise<ScrapeResult> {
  const db = useDb()
  const persist = createPersister(db)
  const maxMonths = opts.maxMonths ?? 300

  const existing = new Set<number>(
    (db.prepare('SELECT id FROM posts').all() as { id: number }[]).map((r) => r.id),
  )
  const newest = db
    .prepare('SELECT id, published_at FROM posts ORDER BY published_at DESC LIMIT 1')
    .get() as { id: number; published_at: number } | undefined
  // Пустая БД: «новее» нечего добирать — это работа обычного scrape (RSS).
  if (!newest) return { posts: 0, comments: 0 }
  const maxId = newest.id

  // Стартовый месяц (UTC) — месяц самого свежего поста; идём вперёд до текущего.
  const start = new Date(newest.published_at * 1000)
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth() + 1 // 1..12
  const now = new Date()
  const curYear = now.getUTCFullYear()
  const curMonth = now.getUTCMonth() + 1

  const picked: number[] = []
  for (let i = 0; i < maxMonths && picked.length < count; i++) {
    let ids: number[] = []
    try {
      ids = await fetchMonthDitemids(year, month)
    } catch (err) {
      console.warn(`[scrapeNewer] пропуск ${year}/${month}:`, (err as Error).message)
    }
    // Только посты новее самого свежего, по возрастанию (ближайшие к границе первыми).
    const fresh = ids.filter((id) => id > maxId && !existing.has(id)).sort((a, b) => a - b)
    for (const id of fresh) {
      if (picked.length >= count) break
      picked.push(id)
      existing.add(id)
    }

    // Дошли до текущего месяца — дальше будущего нет.
    if (year === curYear && month === curMonth) break
    month++
    if (month === 13) {
      month = 1
      year++
    }
    if (picked.length < count && !opts.aggressive) await sleep(600) // вежливая пауза
  }

  return await persistDitemids(persist, picked, opts)
}

/**
 * Докачать **пропущенные** посты: обойти архив (все `ditemid` блога через
 * {@link collectArchiveDitemids}), вычесть уже сохранённые и скачать недостающие.
 * В отличие от `scrapeOlder`/`scrapeNewer` закрывает дырки **где угодно** — в начале,
 * конце и особенно в середине (куда те не дотягиваются, т.к. ходят только за границы).
 * `onScan(done,total)` — прогресс фазы сканирования архива (по годам), до `onStart`.
 */
export async function scrapeMissing(
  opts: ScrapeOpts & { onScan?: (done: number, total: number) => void } = {},
): Promise<ScrapeResult> {
  const archive = await collectArchiveDitemids({ onProgress: opts.onScan })

  const db = useDb()
  const existing = new Set<number>(
    (db.prepare('SELECT id FROM posts').all() as { id: number }[]).map((r) => r.id),
  )
  // Недостающие, новее-первыми (крупный ditemid ≈ свежее).
  const missing = [...archive].filter((id) => !existing.has(id)).sort((a, b) => b - a)

  const persist = createPersister(db)
  return await persistDitemids(persist, missing, opts)
}
