// Общий HTTP-клиент для LiveJournal: единый User-Agent, заголовки и вежливые паузы.

export const LJ_BASE = 'https://evo-lutio.livejournal.com'
export const LJ_JOURNAL = 'evo_lutio'

const USER_AGENT = 'evo-lutio-reader/0.1 (personal pet project)'

/**
 * Потолок на один запрос к ЖЖ. Без него зависшее соединение держало бы задачу
 * (а вместе с ней и блокировку скрейпа) сколь угодно долго.
 */
const REQUEST_TIMEOUT_MS = 20_000

/**
 * GET страницы/эндпоинта ЖЖ, возвращает тело как текст.
 * `retries` — число ДОПОЛНИТЕЛЬНЫХ попыток при сетевом сбое/не-2xx (с бэкоффом);
 * по умолчанию 0 — поведение как раньше. Нужно для долгих обходов (подсчёт постов),
 * где единичный сетевой blip не должен ронять всю операцию.
 * `signal` — внешняя отмена (дедлайн всей задачи скрейпа).
 */
export async function ljGet(
  url: string,
  opts: { rpc?: boolean; retries?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'ru,en;q=0.8',
  }
  // RPC-эндпоинты ЖЖ ожидают XHR-заголовок.
  if (opts.rpc) headers['X-Requested-With'] = 'XMLHttpRequest'

  const attempts = Math.max(0, opts.retries ?? 0) + 1
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    opts.signal?.throwIfAborted() // задача отменена — не начинаем новую попытку
    // Таймаут на попытку + внешняя отмена, что случится раньше.
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, { headers, signal })
      if (!res.ok) throw new Error(`LiveJournal ответил ${res.status} на ${url}`)
      return await res.text()
    } catch (err) {
      if (opts.signal?.aborted) throw err // отмену не ретраим
      lastErr = err
      if (i < attempts - 1) await sleep(500 * (i + 1)) // линейный бэкофф
    }
  }
  throw lastErr
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
