import { LJ_BASE, ljGet } from './client'
import type { RssPost } from './rss'
import { decodeEntities, extract } from './text'

/**
 * Тело одного поста по его ditemid из Atom `/data/atom/?itemid=<id>`.
 * `<content type="html">` содержит полный HTML статьи (включая контент под lj-cut,
 * до маркера `cutid1-end`) — эквивалент `<description>` в RSS, парсим тем же
 * `decodeEntities`. Используется для дозагрузки старых постов из архива, которых
 * уже нет в «свежем хвосте» RSS.
 *
 * Важно: у Atom-фида есть feed-уровневый `<title>` (название журнала) и `<updated>`
 * ДО `<entry>`, поэтому сперва вырезаем сам блок `<entry>…</entry>` и тянем поля
 * уже из него — иначе заголовком поста станет название журнала.
 */
export async function fetchPostByItemid(ditemid: number): Promise<RssPost> {
  const xml = await ljGet(`${LJ_BASE}/data/atom/?itemid=${ditemid}`)
  const entry = extract(xml, 'entry') || xml

  return {
    id: ditemid,
    url: `${LJ_BASE}/${ditemid}.html`,
    title: decodeEntities(extract(entry, 'title')).trim(),
    publishedAt: Math.floor(Date.parse(extract(entry, 'published').trim()) / 1000) || 0,
    // В Atom теги — атрибут `term` самозакрывающегося <category term="…"/>.
    tags: [...entry.matchAll(/<category\b[^>]*\bterm="([^"]*)"/g)].map((m) =>
      decodeEntities(m[1]).trim(),
    ),
    bodyHtml: decodeEntities(extract(entry, 'content')).trim(),
  }
}
