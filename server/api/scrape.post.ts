import { scrape } from '~~/server/utils/lj/scrape'
import { readAggressive, streamScrapeJob } from '~~/server/utils/scrape-endpoint'

// POST /api/scrape { limit?: number } — свежий хвост из RSS (1..25) со стримингом
// прогресса (NDJSON): { type:'start' } → { type:'progress' } → { type:'done' }.
// Только для админа (server/middleware/admin-guard.ts).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ limit?: number; aggressive?: boolean }>(event).catch(() => ({}))
  const limit = Math.min(Math.max(Number(body?.limit) || 10, 1), 25)
  const aggressive = readAggressive(body?.aggressive)

  return streamScrapeJob(event, 'скрейп свежих постов', (send, signal) =>
    scrape(limit, {
      aggressive,
      signal,
      onStart: (total) => send({ type: 'start', total }),
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    }),
  )
})
