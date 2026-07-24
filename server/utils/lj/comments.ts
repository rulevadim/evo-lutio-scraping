import { COMMENTS_PAGE_SIZE } from '../pagination'
import { LJ_BASE, LJ_JOURNAL, ljGet, sleep } from './client'

export interface LjComment {
  id: number // dtalkid
  parentId: number // dtalkid родителя, 0 для верхнеуровневых
  level: number // 1 = верхний уровень
  author: string
  authorJournal: string // URL журнала автора
  bodyHtml: string
  createdAt: number // unix seconds
  position: number // сквозной порядок в threaded pre-order по всем страницам
  deleted: boolean
}

interface RpcComment {
  dtalkid?: number
  parent?: number
  level?: number
  dname?: string
  uname?: string
  commenter_journal_base?: string
  article?: string
  ctime_ts?: number
  deleted?: number
}

interface RpcResponse {
  comments?: RpcComment[]
  replycount?: number
}

function mapComment(c: RpcComment, position: number): LjComment {
  return {
    id: Number(c.dtalkid),
    parentId: Number(c.parent) || 0,
    level: Number(c.level) || 0,
    author: String(c.dname ?? c.uname ?? ''),
    authorJournal: String(c.commenter_journal_base ?? ''),
    bodyHtml: String(c.article ?? ''),
    createdAt: Number(c.ctime_ts) || 0,
    position,
    deleted: Boolean(c.deleted),
  }
}

/**
 * Все комментарии поста через JSON-RPC `__rpc_get_thread` с пагинацией.
 * ЖЖ отдаёт по {@link COMMENTS_PAGE_SIZE} верхнеуровневых веток на страницу
 * (вложенные ответы — целиком внутри своей ветки). Идём по `page=1,2,…`, пока не
 * наберём `replycount` или страница не окажется неполной. `maxPages` — предохранитель
 * от слишком активных постов. Массив приходит в threaded pre-order; ветки между
 * страницами не пересекаются, поэтому `position` монотонно растёт сквозь страницы.
 */
export async function fetchAllComments(
  ditemid: number,
  opts: { maxPages?: number } = {},
): Promise<LjComment[]> {
  const maxPages = opts.maxPages ?? 60
  const all: LjComment[] = []
  const seen = new Set<number>() // dtalkid уже добавленных — против дублей между страницами
  let replycount = Number.POSITIVE_INFINITY

  for (let page = 1; page <= maxPages; page++) {
    const url = `${LJ_BASE}/__rpc_get_thread?journal=${LJ_JOURNAL}&itemid=${ditemid}&flat=&expand_all=1&page=${page}`
    const data = JSON.parse(await ljGet(url, { rpc: true })) as RpcResponse

    if (typeof data.replycount === 'number') replycount = data.replycount
    const batch = (data.comments ?? []).filter((c) => Boolean(c?.dtalkid))
    if (batch.length === 0) break

    // Дедуп по dtalkid: у некоторых постов ЖЖ повторно отдаёт уже виденные комменты
    // на следующих страницах (когда `replycount` больше реального числа из-за
    // удалённых) — иначе получаем дубли и `UNIQUE constraint failed` при вставке.
    let added = 0
    for (const c of batch) {
      const id = Number(c.dtalkid)
      if (seen.has(id)) continue
      seen.add(id)
      all.push(mapComment(c, all.length))
      added++
    }
    // Страница не принесла ничего нового (повтор уже виденного) — это конец.
    if (added === 0) break

    const topLevelInBatch = batch.filter((c) => Number(c.level) === 1).length
    // Достигли конца: набрали всё либо страница неполная (последняя).
    if (all.length >= replycount || topLevelInBatch < COMMENTS_PAGE_SIZE) break

    await sleep(400) // вежливая пауза между страницами
  }

  return all
}
