/**
 * Прогнать `items` через `worker` пулом из `limit` параллельных задач.
 * Общий для агрессивного скрейпа (пул постов) и пробинга картинок.
 */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) await worker(items[cursor++]!)
  })
  await Promise.all(runners)
}
