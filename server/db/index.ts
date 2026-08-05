import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { htmlToText } from '../utils/lj/text'
import { SCHEMA_SQL } from './schema'

let _db: Database.Database | null = null

/** Путь к файлу БД: `DB_PATH` (прод, том контейнера) либо `.data/blog.db` локально. */
export function dbPath(): string {
  return process.env.DB_PATH || join(process.cwd(), '.data', 'blog.db')
}

/**
 * Singleton-подключение к SQLite. Файл БД — `DB_PATH` либо `.data/blog.db` в корне
 * проекта. При первом обращении создаёт папку и применяет схему (idempotent).
 */
export function useDb(): Database.Database {
  if (_db) return _db

  const file = dbPath()
  mkdirSync(dirname(file), { recursive: true })

  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Миграция: старый индекс на trigram пересобираем под новый токенайзер
  // (unicode61) из уже сохранённых постов/комментов, без обращения к ЖЖ.
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'search'")
    .get() as { sql: string } | undefined
  const needsRebuild = Boolean(existing && /trigram/i.test(existing.sql))
  if (needsRebuild) db.exec('DROP TABLE search')

  db.exec(SCHEMA_SQL)

  if (needsRebuild) rebuildSearchIndex(db)

  _db = db
  return db
}

/** Пере-наполнить FTS-индекс `search` из таблиц posts/comments. */
export function rebuildSearchIndex(db: Database.Database): void {
  const insSearch = db.prepare(
    `INSERT INTO search (kind, post_id, ref_id, title, author, content)
     VALUES (@kind, @post_id, @ref_id, @title, @author, @content)`,
  )
  const posts = db.prepare('SELECT id, title, body_html AS bodyHtml FROM posts').all() as {
    id: number
    title: string
    bodyHtml: string
  }[]
  const comments = db
    .prepare('SELECT id, post_id AS postId, author, body_html AS bodyHtml FROM comments')
    .all() as { id: number; postId: number; author: string; bodyHtml: string }[]

  db.transaction(() => {
    db.exec('DELETE FROM search')
    for (const p of posts) {
      insSearch.run({
        kind: 'post',
        post_id: p.id,
        ref_id: p.id,
        title: p.title,
        author: '',
        content: htmlToText(p.bodyHtml),
      })
    }
    for (const c of comments) {
      insSearch.run({
        kind: 'comment',
        post_id: c.postId,
        ref_id: c.id,
        title: '',
        author: c.author,
        content: htmlToText(c.bodyHtml),
      })
    }
  })()
}
