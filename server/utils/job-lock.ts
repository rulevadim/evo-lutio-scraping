// Одна долгая задача на процесс: скрейп или пересчёт статистики.
//
// Аутентификация ограничивает, КТО запускает, но не СКОЛЬКО. Один админ из двух
// вкладок легко запускал бы два обхода архива разом — клиентский флаг `scraping`
// защищает только свою вкладку. Здесь общий на процесс мьютекс: второй запрос
// получает 409 сразу, обычным JSON, ещё до начала NDJSON-потока.

export interface RunningJob {
  name: string
  startedAt: number
}

let holder: symbol | null = null
let running: RunningJob | null = null
let deadlineTimer: NodeJS.Timeout | null = null
let abort: AbortController | null = null

/** Потолок на всю задачу: обход архива с паузами укладывается с большим запасом. */
const DEFAULT_DEADLINE_MS = 30 * 60 * 1000

export interface JobHandle {
  /** Отменяется по дедлайну; пробрасывается в ljGet, чтобы задача реально остановилась. */
  signal: AbortSignal
  release: () => void
}

/**
 * Захватить блокировку. `null` — занято.
 *
 * Освобождать ОБЯЗАТЕЛЬНО в `finally` внутри самой stream-задачи, а не вокруг
 * возврата стрима: хендлер отдаёт `ReadableStream` мгновенно, работа идёт уже
 * внутри него, и внешний `finally` снял бы блокировку сразу после старта.
 */
export function acquireJob(name: string, deadlineMs = DEFAULT_DEADLINE_MS): JobHandle | null {
  if (holder) return null

  const token = Symbol(name)
  holder = token
  running = { name, startedAt: Date.now() }
  abort = new AbortController()

  // Страховка от «вечной» задачи: снимаем блокировку по дедлайну, иначе повисший
  // скрейп заблокировал бы кнопки до перезапуска процесса.
  deadlineTimer = setTimeout(() => {
    abort?.abort(new Error(`Задача «${name}» превысила лимит времени`))
    if (holder === token) clear()
  }, deadlineMs)
  deadlineTimer.unref?.()

  const release = () => {
    if (holder !== token) return // уже снята по дедлайну — повторно не трогаем
    clear()
  }
  return { signal: abort.signal, release }
}

function clear() {
  if (deadlineTimer) clearTimeout(deadlineTimer)
  deadlineTimer = null
  holder = null
  running = null
  abort = null
}

/** Что выполняется сейчас (для текста ошибки 409). */
export function currentJob(): RunningJob | null {
  return running
}
