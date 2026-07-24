import { fetchCalendarYears, fetchMonthDitemids, fetchYearMonths } from './archive'
import { sleep } from './client'

/**
 * Полное число постов в блоге. Точного счётчика ЖЖ не отдаёт, поэтому считаем:
 * `/calendar` → годы, `/YYYY/` → непустые месяцы, `/YYYY/MM/` → `ditemid` месяца;
 * складываем уникальные id в общий Set. Пустые месяцы/годы пропускаем (их нет в
 * календаре-сетке). Дорого (~150 запросов) — вызывать редко и кэшировать.
 */
export async function countBlogPosts(): Promise<number> {
  const R = { retries: 3 } // ~150 живых запросов подряд — единичный blip не должен ронять всё
  const years = await fetchCalendarYears(R)
  const all = new Set<number>()

  for (const year of years) {
    // Если годовая страница не открылась даже с ретраями — не теряем год,
    // а обходим все 12 месяцев (пустые дадут 0).
    let months: number[]
    try {
      months = await fetchYearMonths(year, R)
    } catch {
      months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    }
    await sleep(300)

    for (const month of months) {
      try {
        const ids = await fetchMonthDitemids(year, month, R)
        for (const id of ids) all.add(id)
      } catch (err) {
        // Месяц не дался даже с ретраями — пропускаем (небольшой недосчёт), не роняем обход.
        console.warn(`[countBlogPosts] месяц ${year}/${month} пропущен:`, (err as Error).message)
      }
      await sleep(300) // вежливая пауза между запросами месяцев
    }
  }

  return all.size
}
