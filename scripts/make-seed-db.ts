// Собрать маленькую БД из боевой: несколько постов с комментами.
// Нужна для smoke-теста контейнера и для прогонов бэкофилла «на кошках».
//
// Запуск: npx tsx scripts/make-seed-db.ts [--from=путь] [--to=путь] [--posts=N]

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { rebuildSearchIndex } from '../server/db'
import { META, setMeta } from '../server/db/meta'
import { SCHEMA_SQL } from '../server/db/schema'
import { HTML_SANITIZER_VERSION } from '../server/utils/lj/sanitize'

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]

const from = arg('from') || join(process.cwd(), '.data', 'blog.db')
const to = arg('to') || join(process.cwd(), '.data', 'seed.db')
const nPosts = Number(arg('posts')) || 20

for (const suffix of ['', '-wal', '-shm']) rmSync(`${to}${suffix}`, { force: true })

const src = new Database(from, { readonly: true })
const dst = new Database(to)
dst.pragma('journal_mode = WAL')
dst.exec(SCHEMA_SQL)

const posts = src.prepare('SELECT * FROM posts ORDER BY id DESC LIMIT ?').all(nPosts) as Record<
  string,
  unknown
>[]
const insPost = dst.prepare(`
  INSERT INTO posts (id, url, title, published_at, tags, body_html, scraped_at)
  VALUES (@id, @url, @title, @published_at, @tags, @body_html, @scraped_at)
`)
const insComment = dst.prepare(`
  INSERT INTO comments (id, post_id, parent_id, level, author, author_journal, body_html, created_at, position)
  VALUES (@id, @post_id, @parent_id, @level, @author, @author_journal, @body_html, @created_at, @position)
`)

let comments = 0
dst.transaction(() => {
  for (const p of posts) {
    insPost.run(p)
    const rows = src
      .prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY position')
      .all(p.id as number) as Record<string, unknown>[]
    for (const c of rows) insComment.run(c)
    comments += rows.length
  }
})()

rebuildSearchIndex(dst)
// Контент копируется из уже прогнанной базы, поэтому переносим и маркер версии —
// иначе healthz сочтёт seed-БД несанитизированной и отдаст 503.
setMeta(dst, META.sanitizerVersion, HTML_SANITIZER_VERSION)
dst.pragma('wal_checkpoint(TRUNCATE)')

console.log(`${to}: ${posts.length} постов, ${comments} комментов`)
src.close()
dst.close()
