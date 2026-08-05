import { scrapeNewer } from '~~/server/utils/lj/scrape'
import { readAggressive, readCount, streamScrapeJob } from '~~/server/utils/scrape-endpoint'

// POST /api/scrape/newer { count?: number } — дозагрузка новых постов
// (1..MAX_SCRAPE_COUNT) со стримингом прогресса (NDJSON).
// Только для админа (server/middleware/admin-guard.ts).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ count?: number; aggressive?: boolean }>(event).catch(() => ({}))
  const count = readCount(body?.count)
  const aggressive = readAggressive(body?.aggressive)

  return streamScrapeJob(event, 'дозагрузка новых постов', (send, signal) =>
    scrapeNewer(count, {
      aggressive,
      signal,
      onStart: (total) => send({ type: 'start', total }),
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    }),
  )
})
