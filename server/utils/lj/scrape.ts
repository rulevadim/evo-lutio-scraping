import { useDb } from '../../db'
import { fetchMonthDitemids } from './archive'
import { fetchPostByItemid } from './atomItem'
import { sleep } from './client'
import type { LjComment } from './comments'
import { fetchAllComments } from './comments'
import type { RssPost } from './rss'
import { fetchRecentPosts } from './rss'
import { htmlToText } from './text'

export interface ScrapeResult {
  posts: number
  comments: number
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

/**
 * Оркестратор скрейпинга: RSS → по каждому посту тянем комментарии → upsert в БД
 * и пере-наполнение полнотекстового индекса. Идемпотентно (перезапись по id).
 */
export async function scrape(limit = 10): Promise<ScrapeResult> {
  const db = useDb()
  const persist = createPersister(db)

  const posts = await fetchRecentPosts(limit)
  let commentCount = 0

  for (const post of posts) {
    const comments = await fetchAllComments(post.id)
    persist(post, comments)
    commentCount += comments.length
    await sleep(600) // вежливая пауза между постами
  }

  return { posts: posts.length, comments: commentCount }
}

/**
 * Инкрементальная дозагрузка: добираем `count` постов **старше** самого старого
 * уже сохранённого. Каталог ditemid берём из календарного архива `/YYYY/MM/`, идя
 * месяцами назад от месяца самого старого поста (при пустой БД — от текущего),
 * и **отбрасываем уже сохранённые id** — поэтому добор идёт строго вглубь без
 * пропусков и без затирания имеющихся записей. Тело каждого поста — из Atom по
 * itemid, комментарии — как обычно. `maxMonths` — предохранитель от ухода за
 * начало журнала.
 */
export async function scrapeOlder(
  count = 10,
  opts: { maxMonths?: number } = {},
): Promise<ScrapeResult> {
  const db = useDb()
  const persist = createPersister(db)
  const maxMonths = opts.maxMonths ?? 24

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
  for (let i = 0; i < maxMonths && picked.length < count; i++) {
    let ids: number[] = []
    try {
      ids = await fetchMonthDitemids(year, month)
    } catch (err) {
      // Пустой/недоступный месяц архива не должен ронять весь батч — пропускаем.
      console.warn(`[scrapeOlder] пропуск ${year}/${month}:`, (err as Error).message)
    }
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
    if (picked.length < count) await sleep(600) // вежливая пауза между запросами месяцев
  }

  let commentCount = 0
  for (const id of picked) {
    const post = await fetchPostByItemid(id)
    const comments = await fetchAllComments(id)
    persist(post, comments)
    commentCount += comments.length
    await sleep(600) // вежливая пауза между постами
  }

  return { posts: picked.length, comments: commentCount }
}
