// Снять частоты тегов/атрибутов/схем URL в body_html постов и комментов.
// Нужен, чтобы allowlist санитайзера был выведен из реальных данных, а не придуман.
// Запуск: node scripts/analyze-html.mjs [путь-к-БД]
//
// БД открывается только на чтение — скрипт ничего не меняет.

import Database from 'better-sqlite3'
import { join } from 'node:path'

const file = process.argv[2] || process.env.DB_PATH || join(process.cwd(), '.data', 'blog.db')
const db = new Database(file, { readonly: true })

const tags = new Map() // tag -> count
const attrs = new Map() // "tag@attr" -> count
const schemes = new Map() // "http:" -> count
const flagged = new Map() // потенциально опасное -> count

const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by)

const TAG_RE = /<\s*([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'action', 'background', 'cite'])

function scan(html) {
  if (!html) return
  TAG_RE.lastIndex = 0
  let m
  while ((m = TAG_RE.exec(html))) {
    const tag = m[1].toLowerCase()
    bump(tags, tag)
    if (['script', 'iframe', 'object', 'embed', 'form', 'style', 'link', 'meta', 'base'].includes(tag)) {
      bump(flagged, `<${tag}>`)
    }

    const rest = m[2] || ''
    ATTR_RE.lastIndex = 0
    let a
    while ((a = ATTR_RE.exec(rest))) {
      const name = a[1].toLowerCase()
      if (!name) continue
      bump(attrs, `${tag}@${name}`)
      if (name.startsWith('on')) bump(flagged, `on*-атрибут: ${name}`)

      const raw = (a[2] || '').replace(/^["']|["']$/g, '').trim()
      if (URL_ATTRS.has(name) && raw) {
        const scheme = raw.startsWith('//')
          ? '//(protocol-relative)'
          : (raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1].toLowerCase() ?? '(relative)') +
            (raw.includes(':') ? ':' : '')
        bump(schemes, scheme)
        if (/^\s*(javascript|data|vbscript)\s*:/i.test(raw)) bump(flagged, `URL-схема: ${scheme}`)
      }
    }
  }
}

let n = 0
for (const row of db.prepare('SELECT body_html AS h FROM posts').iterate()) {
  scan(row.h)
  if (++n % 1000 === 0) process.stderr.write(`posts: ${n}\r`)
}
const posts = n

n = 0
for (const row of db.prepare('SELECT body_html AS h FROM comments').iterate()) {
  scan(row.h)
  if (++n % 20000 === 0) process.stderr.write(`comments: ${n}\r`)
}
const comments = n

const sorted = (map) => [...map].sort((a, b) => b[1] - a[1])
const table = (rows, limit = 500) =>
  rows
    .slice(0, limit)
    .map(([k, v]) => `  ${String(v).padStart(9)}  ${k}`)
    .join('\n')

console.log(`Просканировано: ${posts} постов, ${comments} комментов\n`)
console.log(`== ТЕГИ (${tags.size}) ==\n${table(sorted(tags))}\n`)
console.log(`== СХЕМЫ URL ==\n${table(sorted(schemes))}\n`)
console.log(
  `== ПОТЕНЦИАЛЬНО ОПАСНОЕ ==\n${flagged.size ? table(sorted(flagged)) : '  (не найдено)'}\n`,
)
console.log(`== АТРИБУТЫ по тегам (${attrs.size}) ==\n${table(sorted(attrs))}`)

db.close()
