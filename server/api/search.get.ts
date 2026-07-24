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

  // Подтягиваем заголовки постов для контекста результатов.
  const titleOf = new Map<number, string>()
  const ids = [...new Set(rows.map((r) => r.postId))]
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',')
    const titles = db
      .prepare(`SELECT id, title FROM posts WHERE id IN (${placeholders})`)
      .all(...ids) as { id: number; title: string }[]
    for (const t of titles) titleOf.set(t.id, t.title)
  }

  // Для комментария вычисляем страницу пагинации, чтобы ссылка вела сразу туда.
  const posStmt = db.prepare('SELECT post_id AS postId, position FROM comments WHERE id = ?')
  const rankStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM comments WHERE post_id = ? AND parent_id = 0 AND position <= ?',
  )
  const commentPage = (commentId: number): number => {
    const pos = posStmt.get(commentId) as { postId: number; position: number } | undefined
    if (!pos) return 1
    const { n } = rankStmt.get(pos.postId, pos.position) as { n: number }
    return Math.max(1, Math.ceil(n / COMMENTS_PAGE_SIZE))
  }

  const enc = encodeURIComponent(q)
  const results = rows.map((r) => ({
    kind: r.kind,
    postId: r.postId,
    postTitle: titleOf.get(r.postId) ?? '',
    author: r.author,
    snippet: r.snippet,
    // якорь к комментарию на нужной странице пагинации + запрос для подсветки слова
    href:
      r.kind === 'comment'
        ? `/posts/${r.postId}?page=${commentPage(r.refId)}&q=${enc}#c${r.refId}`
        : `/posts/${r.postId}?q=${enc}`,
  }))

  return { query: q, results }
})
