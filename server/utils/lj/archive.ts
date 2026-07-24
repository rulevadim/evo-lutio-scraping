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
export async function fetchMonthDitemids(year: number, month: number): Promise<number[]> {
  const mm = String(month).padStart(2, '0')
  const html = await ljGet(`${LJ_BASE}/${year}/${mm}/`)

  const re = new RegExp(`href=["']${BASE_RE}/(\\d+)\\.html["']`, 'g')
  const ids = new Set<number>()
  for (const m of html.matchAll(re)) ids.add(Number(m[1]))

  return [...ids].sort((a, b) => b - a)
}
