import { fetchCalendarYears, fetchMonthDitemids, fetchYearMonths } from './archive'
import { sleep } from './client'

/**
 * Собрать **все** `ditemid` блога, обойдя архив: `/calendar` → годы, `/YYYY/` →
 * непустые месяцы, `/YYYY/MM/` → id постов. Уникальные складываем в Set. Дорого
 * (~150 запросов, последовательно, с паузами и ретраями) — вызывать редко.
 * `onProgress(done, total)` вызывается после каждого обработанного года.
 */
export async function collectArchiveDitemids(
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<Set<number>> {
  const R = { retries: 3 } // единичный blip на ~150 запросов не должен ронять обход
  const years = await fetchCalendarYears(R)
  const all = new Set<number>()

  for (let i = 0; i < years.length; i++) {
    const year = years[i]!
    // Годовая страница не открылась даже с ретраями — не теряем год, обойдём все 12.
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
        console.warn(`[collectArchiveDitemids] ${year}/${month}:`, (err as Error).message)
      }
      await sleep(300) // вежливая пауза между запросами месяцев
    }
    opts.onProgress?.(i + 1, years.length)
  }

  return all
}

/**
 * Полное число постов в блоге (см. {@link collectArchiveDitemids}). Точного
 * счётчика ЖЖ не отдаёт — считаем обходом архива. Дорого; кэшировать.
 */
export async function countBlogPosts(): Promise<number> {
  return (await collectArchiveDitemids()).size
}
