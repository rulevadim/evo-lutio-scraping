import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'

let _db: Database.Database | null = null

/**
 * Singleton-подключение к SQLite. Файл БД — `.data/blog.db` в корне проекта.
 * При первом обращении создаёт папку и применяет схему (idempotent).
 */
export function useDb(): Database.Database {
  if (_db) return _db

  const file = join(process.cwd(), '.data', 'blog.db')
  mkdirSync(dirname(file), { recursive: true })

  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schema = readFileSync(join(process.cwd(), 'server', 'db', 'schema.sql'), 'utf8')
  db.exec(schema)

  _db = db
  return db
}
