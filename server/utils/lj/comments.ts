import { LJ_BASE, LJ_JOURNAL, ljGet } from './client'

export interface LjComment {
  id: number // dtalkid
  parentId: number // dtalkid родителя, 0 для верхнеуровневых
  level: number // 1 = верхний уровень
  author: string
  authorJournal: string // URL журнала автора
  bodyHtml: string
  createdAt: number // unix seconds
  position: number // порядок в выдаче RPC (threaded pre-order)
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

/**
 * Комментарии поста через JSON-RPC `__rpc_get_thread`.
 * Берём только первую страницу (топ-N веток) — этого достаточно для читалки и
 * поиска, а полная пагинация на активных постах Эволюции — это тысячи запросов.
 * Массив приходит в threaded pre-order; `parent` = dtalkid родителя.
 */
export async function fetchComments(ditemid: number): Promise<LjComment[]> {
  const url = `${LJ_BASE}/__rpc_get_thread?journal=${LJ_JOURNAL}&itemid=${ditemid}&flat=&expand_all=1`
  const raw = JSON.parse(await ljGet(url, { rpc: true })) as { comments?: RpcComment[] }

  return (raw.comments ?? [])
    .filter((c): c is RpcComment & { dtalkid: number } => Boolean(c?.dtalkid))
    .map((c, i) => ({
      id: Number(c.dtalkid),
      parentId: Number(c.parent) || 0,
      level: Number(c.level) || 0,
      author: String(c.dname ?? c.uname ?? ''),
      authorJournal: String(c.commenter_journal_base ?? ''),
      bodyHtml: String(c.article ?? ''),
      createdAt: Number(c.ctime_ts) || 0,
      position: i,
      deleted: Boolean(c.deleted),
    }))
}
