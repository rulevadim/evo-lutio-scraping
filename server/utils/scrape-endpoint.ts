import type { H3Event } from 'h3'
import type { ScrapeResult } from './lj/scrape'
import { acquireJob, currentJob } from './job-lock'
import { streamNdjson } from './stream'

// Общая обвязка для всех эндпоинтов скрейпа: блокировка, заголовки NDJSON, поток.

/** Верхний потолок на разовую дозагрузку. Раньше его не было вовсе. */
export const MAX_SCRAPE_COUNT = 500

export function readCount(raw: unknown, fallback = 10): number {
  const n = Math.trunc(Number(raw)) || fallback
  return Math.min(Math.max(n, 1), MAX_SCRAPE_COUNT)
}

/**
 * Агрессивный режим доступен только в разработке. На бесплатной ВМ с гарантированной
 * долей vCPU 10% шесть параллельных загрузок и так не ускорят дело, а к ЖЖ жёстки.
 */
export function readAggressive(raw: unknown): boolean {
  return import.meta.dev && Boolean(raw)
}

type Send = (obj: unknown) => void

/**
 * Запустить задачу скрейпа как NDJSON-поток под общей блокировкой.
 *
 * Блокировка снимается в `finally` ВНУТРИ потока, а не вокруг вызова: хендлер
 * возвращает `ReadableStream` мгновенно, а работа идёт уже внутри него — внешний
 * `finally` снял бы её сразу после старта, и вторая вкладка запустила бы дубль.
 * Обрыв клиента тоже сюда попадает: `enqueue` в закрытый поток бросает исключение.
 */
export function streamScrapeJob(
  event: H3Event,
  name: string,
  run: (send: Send, signal: AbortSignal) => Promise<ScrapeResult>,
): ReadableStream<Uint8Array> {
  const job = acquireJob(name)
  if (!job) {
    // 409 уходит обычным JSON до начала потока — фронт покажет внятное сообщение.
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `Уже выполняется: ${currentJob()?.name ?? 'другая задача'}`,
    })
  }

  setResponseHeader(event, 'content-type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'x-accel-buffering', 'no')

  return streamNdjson(async (send) => {
    try {
      send({ type: 'done', ...(await run(send, job.signal)) })
    } finally {
      job.release()
    }
  })
}
