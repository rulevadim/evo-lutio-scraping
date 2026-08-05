// Проверка санитайзера перед бэкофиллом: атаки режутся, контент выживает,
// повторный прогон ничего не меняет (идемпотентность).
// Запуск: npx tsx scripts/check-sanitize.ts [путь-к-БД]
//
// БД открывается только на чтение.

import { join } from 'node:path'
import Database from 'better-sqlite3'
import { sanitizeLjHtml, safeExternalUrl } from '../server/utils/lj/sanitize'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? '✓' : '✗ ПРОВАЛ'}  ${name}${detail ? `\n           ${detail}` : ''}`)
}

console.log('== Атаки должны вырезаться ==')
const attacks: [string, string][] = [
  ['onerror в img', '<img src=x onerror="alert(1)">'],
  ['onclick в span', '<span onclick="alert(1)">текст</span>'],
  ['script с телом', '<p>до</p><script>alert(1)</script><p>после</p>'],
  ['javascript: в href', '<a href="javascript:alert(1)">клик</a>'],
  ['data: в img', '<img src="data:text/html;base64,PHNjcmlwdD4=">'],
  ['iframe с чужого хоста', '<iframe src="https://evil.example/x"></iframe>'],
  ['iframe с javascript:', '<iframe src="javascript:alert(1)"></iframe>'],
  ['svg use xlink', '<svg><use xlink:href="https://evil.example/x#a"/></svg>'],
  ['object/embed', '<object data="x"><embed src="y"></object>'],
  ['form', '<form action="https://evil.example"><input name="a"></form>'],
  ['style с url()', '<div style="background:url(javascript:alert(1))">т</div>'],
  ['base', '<base href="https://evil.example/">'],
]
for (const [name, html] of attacks) {
  const out = sanitizeLjHtml(html)
  // Опасен не сам тег, а «живой» источник: iframe без src ничего не грузит.
  const bad =
    /on\w+\s*=|javascript:|<script|<object|<embed|<form|<base|xlink|style=|data:text/i.test(out) ||
    /<iframe[^>]*\bsrc\s*=/i.test(out)
  check(name, !bad, bad ? `получилось: ${out}` : '')
}

console.log('\n== Контент должен выживать ==')
const keep: [string, string, RegExp][] = [
  ['YouTube-видео', '<iframe width="640" height="360" frameborder="0" allowfullscreen src="https://www.youtube.com/embed/abc"></iframe>', /<iframe[^>]+youtube\.com/],
  ['размеры картинки', '<img src="https://ic.pics.livejournal.com/a.jpg" width="600" height="400" loading="lazy" decoding="async">', /width="600"[\s\S]*height="400"[\s\S]*loading="lazy"/],
  ['бейдж lj:user', '<span class="ljuser i-ljuser" data-ljuser="flile" lj:user="flile"><a href="https://flile.livejournal.com/profile/" class="i-ljuser-profile"><img class="i-ljuser-userhead" src="https://l-stat.livejournal.net/x.png"></a></span>', /data-ljuser="flile"[\s\S]*lj:user="flile"/],
  ['protocol-relative → https', '<img src="//ic.pics.livejournal.com/a.jpg">', /src="https:\/\/ic\.pics/],
  ['svg-иконка', '<svg class="svgicon" width="25" height="16" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 24"><path fill-rule="evenodd" d="M19 11z"/></svg>', /<svg[^>]*class="svgicon"[\s\S]*<path[^>]+d="M19 11z"/],
  ['таблица', '<table border="1"><tr><td align="left">я</td></tr></table>', /<table[^>]*><tr><td align="left">я<\/td><\/tr><\/table>/],
  ['цитата и списки', '<blockquote class="c"><ul><li>раз</li></ul></blockquote>', /<blockquote class="c"><ul><li>раз<\/li><\/ul><\/blockquote>/],
]
for (const [name, html, re] of keep) {
  const out = sanitizeLjHtml(html)
  check(name, re.test(out), re.test(out) ? '' : `получилось: ${out}`)
}

console.log('\n== rel добавляется к target ==')
const relOut = sanitizeLjHtml('<a href="https://x.test" target="_blank">t</a>')
check('noopener noreferrer', /rel="noopener noreferrer"/.test(relOut), relOut)

console.log('\n== safeExternalUrl ==')
check('javascript: → пусто', safeExternalUrl('javascript:alert(1)') === '')
check('data: → пусто', safeExternalUrl('data:text/html,x') === '')
check('мусор → пусто', safeExternalUrl('не-url') === '')
check('https проходит', safeExternalUrl('https://flile.livejournal.com/') === 'https://flile.livejournal.com/')
check('//host → https', safeExternalUrl('//flile.livejournal.com/') === 'https://flile.livejournal.com/')

// ── На реальных данных ───────────────────────────────────────────────────────
const file = process.argv[2] || process.env.DB_PATH || join(process.cwd(), '.data', 'blog.db')
const db = new Database(file, { readonly: true })

console.log('\n== Реальные данные: идемпотентность и объём потерь ==')
let rows = 0
let changed = 0
let notIdempotent = 0
let bytesBefore = 0
let bytesAfter = 0
const droppedTag = new Map<string, number>()

const sample = (table: string, limit: number) =>
  db.prepare(`SELECT body_html AS h FROM ${table} ORDER BY id DESC LIMIT ${limit}`).iterate()

const tagsOf = (html: string) => {
  const m = html.match(/<\s*([a-zA-Z][a-zA-Z0-9-]*)/g) ?? []
  const set = new Map<string, number>()
  for (const t of m) {
    const name = t.replace(/[<\s]/g, '').toLowerCase()
    set.set(name, (set.get(name) ?? 0) + 1)
  }
  return set
}

for (const table of ['posts', 'comments']) {
  for (const row of sample(table, table === 'posts' ? 400 : 4000) as Iterable<{ h: string }>) {
    const before = row.h ?? ''
    if (!before) continue
    rows++
    const once = sanitizeLjHtml(before)
    const twice = sanitizeLjHtml(once)
    if (once !== twice) notIdempotent++
    if (once !== before) changed++
    bytesBefore += before.length
    bytesAfter += once.length

    const t0 = tagsOf(before)
    const t1 = tagsOf(once)
    for (const [tag, n] of t0) {
      const lost = n - (t1.get(tag) ?? 0)
      if (lost > 0) droppedTag.set(tag, (droppedTag.get(tag) ?? 0) + lost)
    }
  }
}

check(`идемпотентность на ${rows} записях`, notIdempotent === 0, notIdempotent ? `не идемпотентно: ${notIdempotent}` : '')
console.log(`  выборка: ${rows} записей, изменено ${changed} (${((changed / rows) * 100).toFixed(1)}%)`)
console.log(`  объём: ${(bytesBefore / 1e6).toFixed(1)} МБ → ${(bytesAfter / 1e6).toFixed(1)} МБ (${(((bytesAfter - bytesBefore) / bytesBefore) * 100).toFixed(1)}%)`)
console.log('  выброшенные теги:')
const dropped = [...droppedTag].sort((a, b) => b[1] - a[1])
if (!dropped.length) console.log('    (ничего)')
for (const [tag, n] of dropped) console.log(`    ${String(n).padStart(7)}  <${tag}>`)

db.close()
console.log(`\n${failures ? `ПРОВАЛОВ: ${failures}` : 'Все проверки пройдены.'}`)
process.exit(failures ? 1 : 0)
