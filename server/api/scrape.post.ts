import { scrape } from '~~/server/utils/lj/scrape'
import { streamNdjson } from '~~/server/utils/stream'

// POST /api/scrape { limit?: number } — свежий хвост из RSS (1..25) со стримингом
// прогресса (NDJSON): { type:'start' } → { type:'progress' } → { type:'done' }.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ limit?: number }>(event).catch(() => ({}))
  const limit = Math.min(Math.max(Number(body?.limit) || 10, 1), 25)

  setResponseHeader(event, 'content-type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'x-accel-buffering', 'no')

  return streamNdjson(async (send) => {
    const result = await scrape(limit, {
      onStart: (total) => send({ type: 'start', total }),
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    })
    send({ type: 'done', ...result })
  })
})
