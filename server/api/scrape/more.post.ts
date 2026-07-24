import { scrapeOlder } from '~~/server/utils/lj/scrape'

// Инкрементальная дозагрузка: POST /api/scrape/more { count?: number }
// Добирает `count` постов старше самого старого сохранённого (см. scrapeOlder).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ count?: number }>(event).catch(() => ({}))
  const count = Math.min(Math.max(Number(body?.count) || 10, 1), 25)
  return await scrapeOlder(count)
})
