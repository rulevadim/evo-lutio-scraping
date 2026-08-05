export interface BlogStats {
  scraped: number // постов сохранено в БД
  total: number | null // всего постов в блоге (кэш; null — ещё не считали)
  countedAt: number | null // когда посчитали total (unix seconds)
}

/**
 * Общее состояние статистики постов (шаред между шапкой и страницами через
 * `useState`). `count()` запускает дорогой пересчёт общего числа на сервере.
 */
export function useBlogStats() {
  const stats = useState<BlogStats | null>('blog-stats', () => null)
  const counting = useState<boolean>('blog-stats-counting', () => false)
  const countError = useState<string>('blog-stats-error', () => '')
  const { handleError } = useAdmin()

  // Первичная подгрузка (сохранено + кэш общего). Идемпотентна.
  async function ensureLoaded() {
    if (stats.value) return
    stats.value = await $fetch<BlogStats>('/api/blog-stats')
  }

  async function refresh() {
    stats.value = await $fetch<BlogStats>('/api/blog-stats')
  }

  // Пересчитать общее число постов блога (долго). Кнопка блокируется на время.
  async function count() {
    if (counting.value) return
    counting.value = true
    countError.value = ''
    try {
      stats.value = await $fetch<BlogStats>('/api/blog-stats', { method: 'POST' })
    } catch (err) {
      // Сессия могла истечь молча — handleError сбросит флаг админа, и кнопка исчезнет.
      countError.value = handleError(err)
    } finally {
      counting.value = false
    }
  }

  return { stats, counting, countError, ensureLoaded, refresh, count }
}
