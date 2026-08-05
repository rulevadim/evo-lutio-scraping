import { useDb } from '~~/server/db'
import { META, setMeta } from '~~/server/db/meta'
import { acquireJob, currentJob } from '~~/server/utils/job-lock'
import { countBlogPosts } from '~~/server/utils/lj/stats'

// POST /api/blog-stats — пересчитать общее число постов блога (обход архива по
// месяцам, ~150 запросов, долго) и закэшировать в meta. Возвращает актуальные
// { scraped, total, countedAt }.
// Только для админа (server/middleware/admin-guard.ts).
export default defineEventHandler(async () => {
  // Та же блокировка, что у скрейпа: обход архива — тоже долгая задача к ЖЖ, и
  // запускать её параллельно со скрейпом (или с самой собой) незачем.
  const job = acquireJob('пересчёт числа постов')
  if (!job) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `Уже выполняется: ${currentJob()?.name ?? 'другая задача'}`,
    })
  }

  try {
    const db = useDb()
    const total = await countBlogPosts()
    const now = Math.floor(Date.now() / 1000)

    setMeta(db, META.blogTotal, total)
    setMeta(db, META.blogTotalAt, now)

    const scraped = (db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n
    return { scraped, total, countedAt: now }
  } finally {
    job.release()
  }
})
