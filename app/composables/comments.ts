export interface FlatComment {
  id: number
  parentId: number
  level: number
  author: string
  authorJournal: string
  bodyHtml: string
  createdAt: number
}

export interface CommentNode extends FlatComment {
  children: CommentNode[]
}

/**
 * Собирает дерево комментариев из плоского списка по `parentId`.
 * Список приходит в threaded pre-order, поэтому порядок веток сохраняется.
 */
export function buildCommentTree(flat: FlatComment[]): CommentNode[] {
  const byId = new Map<number, CommentNode>()
  const roots: CommentNode[] = []

  for (const c of flat) byId.set(c.id, { ...c, children: [] })
  for (const c of flat) {
    const node = byId.get(c.id)!
    const parent = c.parentId ? byId.get(c.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}
