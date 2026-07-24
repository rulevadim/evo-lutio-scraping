import { LJ_BASE, ljGet } from './client'

// Экранированный базовый URL журнала для встраивания в регэксп.
const BASE_RE = LJ_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Каталог постов месяца из календарного архива `/YYYY/MM/`.
 * Страница отдаёт список всех записей месяца (тела нет) и, в отличие от
 * RSS/`?skip=`, уходит в прошлое без ограничений. Возвращаем уникальные `ditemid`
 * в порядке убывания (новее-первее).
 *
 * Берём только пермалинки записей самого журнала — ссылки на его домен вида
 * `<base>/<ditemid>.html` с закрывающей кавычкой сразу после `.html` (без
 * `?thread=…` — это виджет «недавние комментарии»). Так отсекаются промо-баннеры,
 * сайдбар и служебные ссылки на другие домены (ru-news, afisha-lj, /support/faq/…),
 * а также sticky/промо-посты вне месяца, которые иначе ломали бы порядок дозагрузки.
 */
export async function fetchMonthDitemids(
  year: number,
  month: number,
  opts: { retries?: number } = {},
): Promise<number[]> {
  const mm = String(month).padStart(2, '0')
  const html = await ljGet(`${LJ_BASE}/${year}/${mm}/`, { retries: opts.retries })

  const re = new RegExp(`href=["']${BASE_RE}/(\\d+)\\.html["']`, 'g')
  const ids = new Set<number>()
  for (const m of html.matchAll(re)) ids.add(Number(m[1]))

  return [...ids].sort((a, b) => b - a)
}

/**
 * Годы, за которые в журнале есть архив — со страницы `/calendar`. Отсекаем явные
 * артефакты (годы вне диапазона 2011..текущий).
 */
export async function fetchCalendarYears(opts: { retries?: number } = {}): Promise<number[]> {
  const html = await ljGet(`${LJ_BASE}/calendar`, { retries: opts.retries })
  const nowYear = new Date().getUTCFullYear()
  return [...new Set([...html.matchAll(/\/(20\d\d)\//g)].map((m) => Number(m[1])))]
    .filter((y) => y >= 2011 && y <= nowYear)
    .sort((a, b) => a - b)
}

/**
 * Номера месяцев года, в которых **есть посты** — из календаря-сетки `/YYYY/`.
 * В нём ссылки на дни `/YYYY/MM/DD/` присутствуют только у непустых дней, поэтому
 * набор их месяцев = непустые месяцы. Позволяет не дёргать пустые месяцы при
 * полном подсчёте.
 */
export async function fetchYearMonths(
  year: number,
  opts: { retries?: number } = {},
): Promise<number[]> {
  const html = await ljGet(`${LJ_BASE}/${year}/`, { retries: opts.retries })
  const re = new RegExp(`/${year}/(\\d\\d)/\\d\\d/`, 'g')
  const months = new Set<number>()
  for (const m of html.matchAll(re)) months.add(Number(m[1]))
  return [...months].sort((a, b) => a - b)
}
