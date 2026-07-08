import { useDb } from '~~/server/db'

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
  // trigram-токенайзеру нужно минимум 3 символа.
  if (q.length < 3) return { query: q, results: [] as unknown[] }

  const db = useDb()
  // Оборачиваем в фразу (экранируя кавычки), чтобы спецсимволы не трактовались
  // как операторы FTS5 — получаем поиск по подстроке.
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

  const results = rows.map((r) => ({
    kind: r.kind,
    postId: r.postId,
    postTitle: titleOf.get(r.postId) ?? '',
    author: r.author,
    snippet: r.snippet,
    // якорь к комментарию на странице поста
    href: r.kind === 'comment' ? `/posts/${r.postId}#c${r.refId}` : `/posts/${r.postId}`,
  }))

  return { query: q, results }
})
