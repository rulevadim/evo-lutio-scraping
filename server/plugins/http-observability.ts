import diagnostics_channel from 'node:diagnostics_channel'

// Наблюдаемость исходящих HTTP-запросов сервера (скрейпинг ЖЖ).
// Эти запросы идут server→LiveJournal и не видны в браузере / Nuxt DevTools.
//
// Управление через переменные окружения:
//   HTTP_DEBUG=1            — лог каждого исходящего fetch в терминал
//   HTTPS_PROXY / HTTP_PROXY — прогнать трафик через Proxyman/mitmproxy
//   HTTP_PROXY_INSECURE=1   — не проверять TLS прокси (быстрый дев-перехват без CA)
export default defineNitroPlugin(() => {
  if (process.env.HTTP_DEBUG) {
    // Каналы публикует undici — движок глобального fetch. Зависимостей не нужно.
    diagnostics_channel.subscribe('undici:request:create', (msg) => {
      const { request } = msg as { request: { method: string; origin: string; path: string } }
      console.log(`[http →] ${request.method} ${request.origin}${request.path}`)
    })
    diagnostics_channel.subscribe('undici:request:headers', (msg) => {
      const { request, response } = msg as {
        request: { origin: string; path: string }
        response: { statusCode: number }
      }
      console.log(`[http ←] ${response.statusCode} ${request.origin}${request.path}`)
    })
    console.log('[http] лог исходящих запросов включён (HTTP_DEBUG)')
  }

  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  if (proxy) {
    // Node'овый fetch не уважает HTTP_PROXY сам — маршрутизируем через ProxyAgent.
    void import('undici')
      .then(({ setGlobalDispatcher, ProxyAgent }) => {
        const insecure = Boolean(process.env.HTTP_PROXY_INSECURE)
        setGlobalDispatcher(
          new ProxyAgent(insecure ? { uri: proxy, requestTls: { rejectUnauthorized: false } } : proxy),
        )
        console.log(`[http] исходящие запросы идут через прокси ${proxy}${insecure ? ' (TLS без проверки)' : ''}`)
      })
      .catch((e) => console.error('[http] не удалось включить прокси:', (e as Error).message))
  }
})
