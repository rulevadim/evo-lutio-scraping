import { scrapeMissing } from '~~/server/utils/lj/scrape'
import { readAggressive, streamScrapeJob } from '~~/server/utils/scrape-endpoint'

// POST /api/scrape/missing { aggressive? } — докачать пропущенные посты (архив ∖ БД).
// Стрим NDJSON: { type:'scan', done, total } (обход архива по годам) →
// { type:'start', total } → { type:'progress', done, total } → { type:'done', posts, comments }.
// Только для админа (server/middleware/admin-guard.ts).
export default defineEventHandler(async (event) => {
  const body = await readBody<{ aggressive?: boolean }>(event).catch(() => ({}))
  const aggressive = readAggressive(body?.aggressive)

  return streamScrapeJob(event, 'докачка пропущенных постов', (send, signal) =>
    scrapeMissing({
      aggressive,
      signal,
      onScan: (done, total) => send({ type: 'scan', done, total }),
      onStart: (total) => send({ type: 'start', total }),
      onProgress: (done, total) => send({ type: 'progress', done, total }),
    }),
  )
})
