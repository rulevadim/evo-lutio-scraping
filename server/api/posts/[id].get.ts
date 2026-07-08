import { useDb } from '~~/server/db'

interface PostRow {
  id: number
  url: string
  title: string
  publishedAt: number
  tags: string
  bodyHtml: string
}

// GET /api/posts/:id — пост + плоский список его комментариев.
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) throw createError({ statusCode: 400, statusMessage: 'Некорректный id' })

  const db = useDb()
  const post = db
    .prepare(
      `SELECT id, url, title, published_at AS publishedAt, tags, body_html AS bodyHtml
       FROM posts WHERE id = ?`,
    )
    .get(id) as PostRow | undefined

  if (!post) throw createError({ statusCode: 404, statusMessage: 'Пост не найден' })

  const comments = db
    .prepare(
      `SELECT id, parent_id AS parentId, level, author, author_journal AS authorJournal,
              body_html AS bodyHtml, created_at AS createdAt
       FROM comments WHERE post_id = ? ORDER BY position`,
    )
    .all(id)

  return {
    post: { ...post, tags: JSON.parse(post.tags) as string[] },
    comments,
  }
})
