// Разовый прогон всей БД через санитайзер HTML.
//
// Санитизация на скрейпе чистит только новое, а в базе уже лежат тысячи постов и
// сотни тысяч комментов, сохранённых до её появления. Пока они не очищены, вход
// админа по паролю не даёт заявленной защиты.
//
// Запуск:  npx tsx scripts/backfill-sanitize.ts [--db=путь] [--batch=N]
//                                              [--skip-snapshot] [--force]
//
// Свойства: пакетно (не одна транзакция на 300k записей), возобновляемо после
// обрыва (курсоры в meta), идемпотентно (повторный прогон ничего не меняет).

import { statfsSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { rebuildSearchIndex, useDb, dbPath } from '../server/db'
import { META, getMeta, setMeta } from '../server/db/meta'
import { HTML_SANITIZER_VERSION, safeExternalUrl, sanitizeLjHtml } from '../server/utils/lj/sanitize'

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const flag = (name: string) => process.argv.includes(`--${name}`)

if (arg('db')) process.env.DB_PATH = arg('db')
const BATCH = Number(arg('batch')) || 2000

const CURSOR = { posts: 'sanitize_cursor_posts', comments: 'sanitize_cursor_comments' } as const

const db = useDb()
const file = dbPath()

// ── 0. Уже сделано? ──────────────────────────────────────────────────────────
const done = Number(getMeta(db, META.sanitizerVersion) ?? 0)
if (done >= HTML_SANITIZER_VERSION && !flag('force')) {
  console.log(
    `БД уже прогнана санитайзером версии ${done} (текущая — ${HTML_SANITIZER_VERSION}).\n` +
      'Нечего делать. Принудительно: --force',
  )
  process.exit(0)
}

console.log(`БД: ${file}`)
console.log(`Версия санитайзера: в БД ${done || '(нет)'} → ${HTML_SANITIZER_VERSION}\n`)

// ── 1. Снапшот ───────────────────────────────────────────────────────────────
if (!flag('skip-snapshot')) {
  const size = statSync(file).size
  const fs = statfsSync(dirname(file))
  const free = fs.bavail * fs.bsize
  if (free < size * 1.2) {
    console.error(
      `Мало места для снапшота: нужно ~${(size / 1e9).toFixed(1)} ГБ, свободно ${(free / 1e9).toFixed(1)} ГБ.\n` +
        'Освободите место либо запустите с --skip-snapshot (если бэкап уже есть).',
    )
    process.exit(1)
  }
  const dest = `${file}.pre-sanitize-v${HTML_SANITIZER_VERSION}.bak`
  process.stdout.write(`Снапшот → ${dest} … `)
  await db.backup(dest)
  console.log('готово\n')
} else {
  console.log('Снапшот пропущен (--skip-snapshot)\n')
}

// ── 2. Бэкофилл пакетами ─────────────────────────────────────────────────────
interface Row {
  id: number
  body_html: string
  author_journal?: string
}

function backfill(table: 'posts' | 'comments'): { seen: number; changed: number } {
  const cursorKey = CURSOR[table]
  let cursor = Number(getMeta(db, cursorKey) ?? 0)
  const total = db.prepare(`SELECT count(*) AS c FROM ${table} WHERE id > ?`).get(cursor) as {
    c: number
  }
  const isComments = table === 'comments'

  const select = db.prepare(
    isComments
      ? 'SELECT id, body_html, author_journal FROM comments WHERE id > ? ORDER BY id LIMIT ?'
      : 'SELECT id, body_html FROM posts WHERE id > ? ORDER BY id LIMIT ?',
  )
  const updHtml = db.prepare(`UPDATE ${table} SET body_html = ? WHERE id = ?`)
  const updJournal = db.prepare('UPDATE comments SET author_journal = ? WHERE id = ?')

  let seen = 0
  let changed = 0

  // Транзакция на пакет: обрыв посреди прогона теряет максимум один пакет,
  // курсор двигается в той же транзакции, что и сами правки.
  const runBatch = db.transaction((rows: Row[]) => {
    for (const r of rows) {
      const clean = sanitizeLjHtml(r.body_html ?? '')
      if (clean !== r.body_html) {
        updHtml.run(clean, r.id)
        changed++
      }
      if (isComments && r.author_journal) {
        const safe = safeExternalUrl(r.author_journal)
        if (safe !== r.author_journal) updJournal.run(safe, r.id)
      }
    }
    setMeta(db, cursorKey, rows[rows.length - 1]!.id)
  })

  for (;;) {
    const rows = select.all(cursor, BATCH) as Row[]
    if (!rows.length) break
    runBatch(rows)
    cursor = rows[rows.length - 1]!.id
    seen += rows.length
    process.stdout.write(`  ${table}: ${seen}/${total.c}, изменено ${changed}\r`)
  }
  process.stdout.write(`  ${table}: ${seen}/${total.c}, изменено ${changed}\n`)
  return { seen, changed }
}

console.log('Санитизация тел постов и комментов:')
const p = backfill('posts')
const c = backfill('comments')

// ── 3. Пересборка FTS ────────────────────────────────────────────────────────
// Обязательна: htmlToText снимает теги, но содержимое <script> оставляет, а
// sanitize-html вырезает его целиком. Без пересборки поиск находил бы текст,
// которого на странице уже нет.
process.stdout.write('\nПересборка FTS-индекса (несколько минут) … ')
rebuildSearchIndex(db)
console.log('готово')

// ── 4. Финализация ───────────────────────────────────────────────────────────
setMeta(db, META.sanitizerVersion, HTML_SANITIZER_VERSION)
db.prepare(`DELETE FROM meta WHERE key IN (?, ?)`).run(CURSOR.posts, CURSOR.comments)

process.stdout.write('WAL checkpoint … ')
db.pragma('wal_checkpoint(TRUNCATE)')
console.log('готово')

console.log(
  `\nГотово. Постов: ${p.seen} (изменено ${p.changed}), комментов: ${c.seen} (изменено ${c.changed}).\n` +
    `meta.${META.sanitizerVersion} = ${HTML_SANITIZER_VERSION}\n\n` +
    'Файл БД мог вырасти из-за пересборки индекса — при желании сожмите:\n' +
    `  sqlite3 ${file} "VACUUM;"`,
)
db.close()
