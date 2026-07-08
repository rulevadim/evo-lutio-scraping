import { useDb } from '../../db'
import { sleep } from './client'
import { fetchAllComments } from './comments'
import { fetchRecentPosts } from './rss'
import { htmlToText } from './text'

export interface ScrapeResult {
  posts: number
  comments: number
}

/**
 * Оркестратор скрейпинга: RSS → по каждому посту тянем комментарии → upsert в БД
 * и пере-наполнение полнотекстового индекса. Идемпотентно (перезапись по id).
 */
export async function scrape(limit = 10): Promise<ScrapeResult> {
  const db = useDb()

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

  const posts = await fetchRecentPosts(limit)
  let commentCount = 0

  for (const post of posts) {
    const comments = await fetchAllComments(post.id)
    const now = Math.floor(Date.now() / 1000)

    db.transaction(() => {
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
    })()

    commentCount += comments.length
    await sleep(600) // вежливая пауза между постами
  }

  return { posts: posts.length, comments: commentCount }
}
