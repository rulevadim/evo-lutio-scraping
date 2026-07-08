import { scrape } from '~~/server/utils/lj/scrape'

// Ручной триггер обновления данных: POST /api/scrape { limit?: number }
export default defineEventHandler(async (event) => {
  const body = await readBody<{ limit?: number }>(event).catch(() => ({}))
  const limit = Math.min(Math.max(Number(body?.limit) || 10, 1), 25)
  return await scrape(limit)
})
