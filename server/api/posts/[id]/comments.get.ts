import { useDb } from '~~/server/db'
import { COMMENTS_PAGE_SIZE } from '~~/server/utils/pagination'

interface CommentRow {
  id: number
  parentId: number
  level: number
  author: string
  authorJournal: string
  bodyHtml: string
  createdAt: number
}

// GET /api/posts/:id/comments?page=N — страница комментариев поста.
// Пагинация по верхнеуровневым веткам (COMMENTS_PAGE_SIZE на страницу), как на сайте.
// Ветка со всеми вложенными ответами идёт в pre-order сплошным блоком по `position`,
// поэтому страницу выбираем диапазоном позиций между началами N-й и (N+1)-й веток.
// Размеры картинок уже вписаны в body_html на скрейпе — тут ничего не пробим.
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Некорректный id' })

  const db = useDb()

  const tops = db
    .prepare('SELECT position FROM comments WHERE post_id = ? AND parent_id = 0 ORDER BY position')
    .all(id) as { position: number }[]

  const totalPages = Math.max(1, Math.ceil(tops.length / COMMENTS_PAGE_SIZE))
  const requested = Number(getQuery(event).page) || 1
  const page = Math.min(Math.max(Math.trunc(requested), 1), totalPages)

  let comments: CommentRow[] = []
  if (tops.length) {
    const startPos = tops[(page - 1) * COMMENTS_PAGE_SIZE]!.position
    const nextTop = tops[page * COMMENTS_PAGE_SIZE]
    const endPos = nextTop ? nextTop.position : Number.MAX_SAFE_INTEGER

    comments = db
      .prepare(
        `SELECT id, parent_id AS parentId, level, author, author_journal AS authorJournal,
                body_html AS bodyHtml, created_at AS createdAt
         FROM comments
         WHERE post_id = ? AND position >= ? AND position < ?
         ORDER BY position`,
      )
      .all(id, startPos, endPos) as CommentRow[]
  }

  return { page, totalPages, totalTop: tops.length, comments }
})
