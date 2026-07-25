import { scrapeMissing } from '~~/server/utils/lj/scrape'
import { streamNdjson } from '~~/server/utils/stream'

// POST /api/scrape/missing { aggressive? } — докачать пропущенные посты (архив ∖ БД).
// Стрим NDJSON: { type:'scan', done, total } (обход архива по годам) →
// { type:'start', total } → { type:'progress', done, total } → { type:'done', posts, comments }.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ aggressive?: boolean }>(event).catch(() => ({}))
  const aggressive = Boolean(body?.aggressive)

  setResponseHeader(event, 'content-type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'x-accel-buffering', 'no')

  return streamNdjson(async (send) => {
    const result = await scrapeMissing({
      aggressive,
      onScan: (done, total) => send({ type: 'scan', done, total }),
      onStart: (total) => send({ type: 'start', total }),
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    })
    send({ type: 'done', ...result })
  })
})
