/**
 * Обёртка для стриминга NDJSON-ответа: возвращает web-`ReadableStream`, в который
 * `handler` шлёт объекты через `send` (каждый — строка JSON + '\n'). Исключение из
 * `handler` уходит клиенту как `{ type: 'error', message }`, после чего поток
 * закрывается. Используется для прогресса долгих скрейпов.
 */
export function streamNdjson(
  handler: (send: (obj: unknown) => void) => Promise<void>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
      try {
        await handler(send)
      } catch (err) {
        send({ type: 'error', message: (err as Error).message })
      } finally {
        controller.close()
      }
    },
  })
}
