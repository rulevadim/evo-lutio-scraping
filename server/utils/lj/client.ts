// Общий HTTP-клиент для LiveJournal: единый User-Agent, заголовки и вежливые паузы.

export const LJ_BASE = 'https://evo-lutio.livejournal.com'
export const LJ_JOURNAL = 'evo_lutio'

const USER_AGENT = 'evo-lutio-reader/0.1 (personal pet project)'

/**
 * GET страницы/эндпоинта ЖЖ, возвращает тело как текст.
 * `retries` — число ДОПОЛНИТЕЛЬНЫХ попыток при сетевом сбое/не-2xx (с бэкоффом);
 * по умолчанию 0 — поведение как раньше. Нужно для долгих обходов (подсчёт постов),
 * где единичный сетевой blip не должен ронять всю операцию.
 */
export async function ljGet(
  url: string,
  opts: { rpc?: boolean; retries?: number } = {},
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
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`LiveJournal ответил ${res.status} на ${url}`)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await sleep(500 * (i + 1)) // линейный бэкофф
    }
  }
  throw lastErr
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
