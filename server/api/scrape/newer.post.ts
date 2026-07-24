import { scrapeNewer } from '~~/server/utils/lj/scrape'

// Дозагрузка новых: POST /api/scrape/newer { count?: number }
// Добирает `count` постов новее самого свежего сохранённого (см. scrapeNewer).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ count?: number }>(event).catch(() => ({}))
  const count = Math.min(Math.max(Number(body?.count) || 10, 1), 25)
  return await scrapeNewer(count)
})
