import { scrapeOlder } from '~~/server/utils/lj/scrape'
import { streamNdjson } from '~~/server/utils/stream'

// POST /api/scrape/more { count?: number } — дозагрузка старых постов (count ≥1, без потолка)
// со стримингом прогресса (NDJSON): { type:'start', total } → { type:'progress',
// done, total } на каждый пост → { type:'done', posts, comments }.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ count?: number; aggressive?: boolean }>(event).catch(() => ({}))
  const count = Math.max(Number(body?.count) || 10, 1) // без верхнего потолка
  const aggressive = Boolean(body?.aggressive)

  setResponseHeader(event, 'content-type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'x-accel-buffering', 'no')

  return streamNdjson(async (send) => {
    const result = await scrapeOlder(count, {
      aggressive,
      onStart: (total) => send({ type: 'start', total }),
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    })
    send({ type: 'done', ...result })
  })
})
