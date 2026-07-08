import { useDb } from '~~/server/db'

interface PostRow {
  id: number
  title: string
  publishedAt: number
  tags: string
  commentCount: number
}

// GET /api/posts — список постов для главной.
export default defineEventHandler(() => {
  const db = useDb()
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.published_at AS publishedAt, p.tags,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS commentCount
       FROM posts p
       ORDER BY p.published_at DESC`,
    )
    .all() as PostRow[]

  return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[] }))
})
