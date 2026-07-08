import { useDb } from '~~/server/db'

interface PostRow {
  id: number
  url: string
  title: string
  publishedAt: number
  tags: string
  bodyHtml: string
}

// GET /api/posts/:id — мета поста + число комментариев.
// Сами комментарии отдаёт постранично /api/posts/:id/comments.
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

  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?')
    .get(id) as { n: number }

  return {
    post: { ...post, tags: JSON.parse(post.tags) as string[] },
    commentCount: n,
  }
})
