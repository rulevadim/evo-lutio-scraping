import { useDb } from '~~/server/db'

// GET /api/blog-stats — сколько постов сохранено + кэш общего числа постов блога.
// Общее число дорого считать (см. POST), поэтому тут только читаем кэш из meta.
export default defineEventHandler(() => {
  const db = useDb()
  const scraped = (db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n

  const get = db.prepare('SELECT value FROM meta WHERE key = ?')
  const totalRow = get.get('blog_total') as { value: string } | undefined
  const atRow = get.get('blog_total_at') as { value: string } | undefined

  return {
    scraped,
    total: totalRow ? Number(totalRow.value) : null,
    countedAt: atRow ? Number(atRow.value) : null,
  }
})
