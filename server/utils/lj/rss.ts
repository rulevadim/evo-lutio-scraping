import { LJ_BASE, ljGet } from './client'
import { decodeEntities } from './text'

export interface RssPost {
  id: number // ditemid
  url: string
  title: string
  publishedAt: number // unix seconds
  tags: string[]
  bodyHtml: string
}

function extract(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return m ? m[1] : ''
}

/**
 * Последние посты из RSS `/data/rss`.
 * Тело поста берём прямо из <description> — там полный HTML статьи (с картинками),
 * поэтому отдельные страницы постов парсить не нужно.
 */
export async function fetchRecentPosts(limit = 10): Promise<RssPost[]> {
  const xml = await ljGet(`${LJ_BASE}/data/rss`)
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []

  const posts: RssPost[] = []
  for (const item of items.slice(0, limit)) {
    const link = decodeEntities(extract(item, 'link') || extract(item, 'guid')).trim()
    const idMatch = link.match(/(\d+)\.html/)
    if (!idMatch) continue

    posts.push({
      id: Number(idMatch[1]),
      url: link,
      title: decodeEntities(extract(item, 'title')).trim(),
      publishedAt: Math.floor(Date.parse(extract(item, 'pubDate').trim()) / 1000) || 0,
      tags: [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) =>
        decodeEntities(m[1]).trim(),
      ),
      bodyHtml: decodeEntities(extract(item, 'description')).trim(),
    })
  }
  return posts
}
