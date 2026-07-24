import { useDb } from '~~/server/db'
import { COMMENTS_PAGE_SIZE } from '~~/server/utils/pagination'

interface SearchRow {
  kind: 'post' | 'comment'
  postId: number
  refId: number
  snippet: string
  author: string
}

// GET /api/search?q=... — полнотекстовый поиск по постам и комментариям.
export default defineEventHandler((event) => {
  const q = String(getQuery(event).q ?? '').trim()
  // Порог в 3 символа — чтобы не искать по слишком коротким/шумным запросам.
  if (q.length < 3) return { query: q, results: [] as unknown[] }

  const db = useDb()
  // Оборачиваем в фразу (экранируя кавычки), чтобы спецсимволы (—, ", *, : и т.п.)
  // не трактовались как операторы FTS5, а искались буквально. Токенайзер unicode61 —
  // пословный: матч по целым словам (не по подстрокам).
  const match = `"${q.replace(/"/g, '""')}"`

  const rows = db
    .prepare(
      `SELECT kind, post_id AS postId, ref_id AS refId, author,
              snippet(search, 5, '[', ']', '…', 12) AS snippet
       FROM search
       WHERE search MATCH ?
       ORDER BY bm25(search)
       LIMIT 50`,
    )
    .all(match) as SearchRow[]

  // Подтягиваем заголовок и дату поста для контекста результатов.
  const postOf = new Map<number, { title: string; publishedAt: number }>()
  const ids = [...new Set(rows.map((r) => r.postId))]
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    const metas = db
      .prepare(`SELECT id, title, published_at AS publishedAt FROM posts WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number; title: string; publishedAt: number }[]
    for (const m of metas) postOf.set(m.id, { title: m.title, publishedAt: m.publishedAt })
  }

  // Для комментария нужны его дата и страница пагинации (чтобы ссылка вела сразу туда).
  const commentStmt = db.prepare(
    'SELECT post_id AS postId, position, created_at AS createdAt FROM comments WHERE id = ?',
  )
  const rankStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND parent_id = 0 AND position <= ?',
  )
  const pageOf = (postId: number, position: number): number => {
    const { n } = rankStmt.get(postId, position) as { n: number }
    return Math.max(1, Math.ceil(n / COMMENTS_PAGE_SIZE))
  }

  const enc = encodeURIComponent(q)
  const results = rows.map((r) => {
    const post = postOf.get(r.postId)
    if (r.kind === 'comment') {
      const c = commentStmt.get(r.refId) as
        | { postId: number; position: number; createdAt: number }
        | undefined
      return {
        kind: r.kind,
        postId: r.postId,
        postTitle: post?.title ?? '',
        author: r.author,
        snippet: r.snippet,
        createdAt: c?.createdAt ?? 0, // дата самого коммента
        // якорь к комментарию на нужной странице пагинации + запрос для подсветки слова
        href: `/posts/${r.postId}?page=${c ? pageOf(c.postId, c.position) : 1}&q=${enc}#c${r.refId}`,
      }
    }
    return {
      kind: r.kind,
      postId: r.postId,
      postTitle: post?.title ?? '',
      author: r.author,
      snippet: r.snippet,
      createdAt: post?.publishedAt ?? 0, // дата поста
      href: `/posts/${r.postId}?q=${enc}`,
    }
  })

  return { query: q, results }
})
