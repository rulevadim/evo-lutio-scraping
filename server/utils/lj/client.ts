// Общий HTTP-клиент для LiveJournal: единый User-Agent, заголовки и вежливые паузы.

export const LJ_BASE = 'https://evo-lutio.livejournal.com'
export const LJ_JOURNAL = 'evo_lutio'

const USER_AGENT = 'evo-lutio-reader/0.1 (personal pet project)'

/** GET страницы/эндпоинта ЖЖ, возвращает тело как текст. */
export async function ljGet(url: string, opts: { rpc?: boolean } = {}): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'ru,en;q=0.8',
  }
  // RPC-эндпоинты ЖЖ ожидают XHR-заголовок.
  if (opts.rpc) headers['X-Requested-With'] = 'XMLHttpRequest'

  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`LiveJournal ответил ${res.status} на ${url}`)
  return await res.text()
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
