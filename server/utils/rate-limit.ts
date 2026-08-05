import type { H3Event } from 'h3'

// Простой лимитер в памяти процесса. Для одного инстанса этого достаточно;
// при масштабировании на несколько процессов понадобится общее хранилище.

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
/** Чтобы карта не росла бесконечно от случайных IP. */
const MAX_BUCKETS = 10_000

/** `true` — лимит превышен. */
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()

  if (buckets.size > MAX_BUCKETS) {
    for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k)
    if (buckets.size > MAX_BUCKETS) buckets.clear()
  }

  const bucket = buckets.get(key)
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  bucket.count++
  return bucket.count > max
}

/**
 * IP клиента. Берётся из `X-Forwarded-For`, который клиент может подделать, —
 * поэтому в проде обратный прокси обязан ПЕРЕЗАПИСЫВАТЬ этот заголовок
 * (`header_up X-Forwarded-For {remote_host}` в Caddy), а не дописывать в него.
 * Иначе лимит обходится одной строкой в запросе.
 */
export function clientIp(event: H3Event): string {
  return getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
}
