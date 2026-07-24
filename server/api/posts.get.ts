import { useDb } from '~~/server/db'

interface PostRow {
  id: number
  title: string
  publishedAt: number
  tags: string
  commentCount: number
}

// Размер страницы списка постов (как «10 последних» на первой странице).
const POSTS_PAGE_SIZE = 10

// GET /api/posts?page=N — страница списка постов для главной (новые сверху).
export default defineEventHandler((event) => {
  const db = useDb()

  const total = (db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n
  const totalPages = Math.max(1, Math.ceil(total / POSTS_PAGE_SIZE))
  const requested = Number(getQuery(event).page) || 1
  const page = Math.min(Math.max(Math.trunc(requested), 1), totalPages)

  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.published_at AS publishedAt, p.tags,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS commentCount
       FROM posts p
       ORDER BY p.published_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(POSTS_PAGE_SIZE, (page - 1) * POSTS_PAGE_SIZE) as PostRow[]

  const posts = rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[] }))
  return { page, totalPages, total, posts }
})
