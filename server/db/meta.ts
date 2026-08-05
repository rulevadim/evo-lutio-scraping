import type { Database } from 'better-sqlite3'

/** Ключи таблицы `meta` (мелкий key-value рядом с контентом). */
export const META = {
  /** Общее число постов блога (кэш дорогого обхода архива). */
  blogTotal: 'blog_total',
  /** Когда посчитали `blog_total`, unix seconds. */
  blogTotalAt: 'blog_total_at',
  /**
   * Версия правил санитизации, которой прогнан весь контент в этой БД.
   * Пусто/меньше текущей → база не санитизирована, её нельзя показывать в проде
   * (см. `HTML_SANITIZER_VERSION` и healthcheck).
   */
  sanitizerVersion: 'html_sanitizer_version',
} as const

export function getMeta(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setMeta(db: Database, key: string, value: string | number): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value))
}
