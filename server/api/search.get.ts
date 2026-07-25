import { useDb } from '~~/server/db'
import { COMMENTS_PAGE_SIZE } from '~~/server/utils/pagination'

interface SearchRow {
  kind: 'post' | 'comment'
  postId: number
  refId: number
  snippet: string
  author: string
  createdAt: number // дата поста/коммента (для сортировки и вывода)
}

const SEARCH_PAGE_SIZE = 100

// GET /api/search?q=...&sort=relevance|date_desc|date_asc&page=N — полнотекстовый поиск.
export default defineEventHandler((event) => {
  const q = String(getQuery(event).q ?? '').trim()
  // Порог в 3 символа — чтобы не искать по слишком коротким/шумным запросам.
  if (q.length < 3) {
    return { query: q, page: 1, totalPages: 1, total: 0, results: [] as unknown[] }
  }

  const db = useDb()
  // Оборачиваем в фразу (экранируя кавычки), чтобы спецсимволы (—, ", *, : и т.п.)
  // не трактовались как операторы FTS5, а искались буквально. Токенайзер unicode61 —
  // пословный: матч по целым словам (не по подстрокам).
  const match = `"${q.replace(/"/g, '""')}"`

  // Сортировка: релевантность (bm25) либо дата в обе стороны. `ORDER BY` берём из
  // белого списка (не из строки пользователя) — без риска инъекции. Дату считаем
  // прямо в запросе (пост → published_at, коммент → created_at), чтобы сортировать
  // по ней ВСЕ совпадения, а не только топ-50 по релевантности.
  const sort = String(getQuery(event).sort ?? 'relevance')
  const orderBy =
    sort === 'date_desc'
      ? 'createdAt DESC'
      : sort === 'date_asc'
        ? 'createdAt ASC'
        : 'bm25(search)'

  // Всего совпадений — для пагинации; страницу клампим на сервере.
  const total = (
    db.prepare('SELECT COUNT(*) AS n FROM search WHERE search MATCH ?').get(match) as { n: number }
  ).n
  const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE))
  const requested = Number(getQuery(event).page) || 1
  const page = Math.min(Math.max(Math.trunc(requested), 1), totalPages)

  const rows = db
    .prepare(
      `SELECT kind, post_id AS postId, ref_id AS refId, author,
              snippet(search, 5, '[', ']', '…', 12) AS snippet,
              CASE kind
                WHEN 'post' THEN (SELECT published_at FROM posts WHERE id = search.ref_id)
                ELSE (SELECT created_at FROM comments WHERE id = search.ref_id)
              END AS createdAt
       FROM search
       WHERE search MATCH ?
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(match, SEARCH_PAGE_SIZE, (page - 1) * SEARCH_PAGE_SIZE) as SearchRow[]

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

  // Для комментария нужна страница пагинации (чтобы ссылка вела сразу туда); дата
  // уже посчитана в основном запросе (r.createdAt).
  const commentStmt = db.prepare('SELECT post_id AS postId, position FROM comments WHERE id = ?')
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
    const base = {
      kind: r.kind,
      postId: r.postId,
      postTitle: post?.title ?? '',
      author: r.author,
      snippet: r.snippet,
      createdAt: r.createdAt ?? 0,
    }
    if (r.kind === 'comment') {
      const c = commentStmt.get(r.refId) as { postId: number; position: number } | undefined
      // якорь к комментарию на нужной странице пагинации + запрос для подсветки слова
      return { ...base, href: `/posts/${r.postId}?page=${c ? pageOf(c.postId, c.position) : 1}&q=${enc}#c${r.refId}` }
    }
    return { ...base, href: `/posts/${r.postId}?q=${enc}` }
  })

  return { query: q, page, totalPages, total, results }
})
