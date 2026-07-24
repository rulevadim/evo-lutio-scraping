import { useDb } from '~~/server/db'
import { countBlogPosts } from '~~/server/utils/lj/stats'

// POST /api/blog-stats — пересчитать общее число постов блога (обход архива по
// месяцам, ~150 запросов, долго) и закэшировать в meta. Возвращает актуальные
// { scraped, total, countedAt }.
export default defineEventHandler(async () => {
  const db = useDb()
  const total = await countBlogPosts()
  const now = Math.floor(Date.now() / 1000)

  const set = db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  set.run('blog_total', String(total))
  set.run('blog_total_at', String(now))

  const scraped = (db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n
  return { scraped, total, countedAt: now }
})
