import { scrapeNewer } from '~~/server/utils/lj/scrape'
import { streamNdjson } from '~~/server/utils/stream'

// POST /api/scrape/newer { count?: number } — дозагрузка новых постов со стримингом
// прогресса (NDJSON): { type:'start' } → { type:'progress' } → { type:'done' }.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ count?: number }>(event).catch(() => ({}))
  const count = Math.max(Number(body?.count) || 10, 1) // без верхнего потолка

  setResponseHeader(event, 'content-type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'x-accel-buffering', 'no')

  return streamNdjson(async (send) => {
    const result = await scrapeNewer(count, {
      onStart: (total) => send({ type: 'start', total }),
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    })
    send({ type: 'done', ...result })
  })
})
