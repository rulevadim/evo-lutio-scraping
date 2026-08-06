import { lookup as dnsLookup } from 'node:dns'
import type { LookupAddress } from 'node:dns'
import { isIP } from 'node:net'
import { Agent, fetch as undiciFetch } from 'undici'

// Защищённый fetch для URL, пришедших из чужого контента (src картинок в постах и
// комментах ЖЖ). Без него сервер по указке автора коммента ходил бы куда угодно —
// в том числе на 169.254.169.254 (metadata облака) и на соседей по внутренней сети.
//
// Проверка «сначала dns.lookup, потом обычный fetch по имени» не годится: между
// проверкой и соединением имя может перерезолвиться во внутренний адрес
// (DNS rebinding). Поэтому валидация встроена в сам резолвер диспетчера — undici
// соединяется только с тем адресом, который прошёл проверку. Побочный плюс:
// редиректы идут через тот же диспетчер, значит проверяются автоматически.

/** Непубличные диапазоны IPv4: base-адрес и длина префикса. */
const V4_BLOCKED: readonly [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8      «этот» хост
  [0x0a000000, 8], // 10.0.0.0/8     частная сеть
  [0x64400000, 10], // 100.64.0.0/10  CGNAT
  [0x7f000000, 8], // 127.0.0.0/8    loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local (metadata облака)
  [0xac100000, 12], // 172.16.0.0/12  частная сеть
  [0xc0000000, 24], // 192.0.0.0/24   IETF
  [0xc0000200, 24], // 192.0.2.0/24   TEST-NET-1
  [0xc0a80000, 16], // 192.168.0.0/16 частная сеть
  [0xc6120000, 15], // 198.18.0.0/15  бенчмарки
  [0xc6336400, 24], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24 TEST-NET-3
  [0xe0000000, 4], // 224.0.0.0/4    multicast
  [0xf0000000, 4], // 240.0.0.0/4    reserved + broadcast
]

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const v = Number(part)
    if (v > 255) return null
    n = (n << 8) | v
  }
  return n >>> 0
}

function blockedV4(n: number): boolean {
  return V4_BLOCKED.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits))
}

/**
 * Развернуть IPv6 в 8 групп по 16 бит. `null` — разобрать не удалось.
 *
 * Нужно именно развёртывание, а не сравнение строковых префиксов: одна и та же
 * запись имеет много форм, и URL нормализует их по-своему. Так,
 * `::ffff:169.254.169.254` превращается в `::ffff:a9fe:a9fe` — по точке такую
 * запись уже не опознать.
 */
function expandIpv6(addr: string): number[] | null {
  if (!addr.includes(':')) return null
  const halves = addr.split('::')
  if (halves.length > 2) return null

  const parse = (s: string) =>
    s ? s.split(':').filter(Boolean).map((g) => parseInt(g, 16)) : []
  const head = parse(halves[0]!)
  if (head.some(Number.isNaN)) return null

  if (halves.length === 1) return head.length === 8 ? head : null

  const tail = parse(halves[1]!)
  if (tail.some(Number.isNaN)) return null
  const gap = 8 - head.length - tail.length
  if (gap < 0) return null
  return [...head, ...Array(gap).fill(0), ...tail]
}

/**
 * Непубличный ли адрес. Экспортируется ради тестов: именно этот предикат решает,
 * пустят ли запрос наружу. Всё, что не удалось уверенно опознать как публичный
 * адрес, считается непубличным.
 */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase().split('%')[0]! // отбросить zone id (fe80::1%eth0)

  const v4 = ipv4ToInt(addr)
  if (v4 !== null) return blockedV4(v4)

  if (!addr.includes(':')) return true // не IP вообще — не пускаем

  // Запись с точками (::ffff:1.2.3.4, ::1.2.3.4) — проверяем хвост как IPv4.
  if (addr.includes('.')) {
    const tail = addr.slice(addr.lastIndexOf(':') + 1)
    return ipv4ToInt(tail) === null || isBlockedAddress(tail)
  }

  const groups = expandIpv6(addr)
  if (!groups) return true // не разобрали — не рискуем

  // IPv4-mapped (::ffff:x:x) и IPv4-compatible (::x:x): последние 32 бита — это
  // IPv4, его и проверяем. Сюда же попадают :: и ::1 (дают 0.0.0.0/8).
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    return blockedV4(((groups[6]! * 0x10000 + groups[7]!) >>> 0) as number)
  }

  const first = groups[0]!
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7  unique-local
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true // ff00::/8  multicast
  return false
}

/**
 * Резолвер для undici: отдаёт соединению только публичные адреса. Если у имени
 * все адреса непубличные — соединение не состоится вовсе.
 */
const publicOnlyLookup = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
): void => {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, '', 0)
    const safe = (addresses as LookupAddress[]).filter((a) => !isBlockedAddress(a.address))
    if (!safe.length) {
      const blocked = new Error(
        `${hostname}: все адреса непубличные — запрос заблокирован`,
      ) as NodeJS.ErrnoException
      blocked.code = 'EBLOCKED'
      return callback(blocked, '', 0)
    }
    if (options?.all) return callback(null, safe)
    callback(null, safe[0]!.address, safe[0]!.family)
  })
}

let _agent: Agent | null = null
function publicAgent(): Agent {
  // Ленивая инициализация: не трогаем сеть, пока никто не просил. Важно, что это
  // не глобальный диспетчер — HTTPS_PROXY-режим из http-observability.ts остаётся
  // рабочим для остального трафика.
  _agent ??= new Agent({
    connect: { lookup: publicOnlyLookup, timeout: 4000 },
    headersTimeout: 5000,
    bodyTimeout: 5000,
  })
  return _agent
}

export class UnsafeUrlError extends Error {}

/**
 * `fetch` наружу по недоверенному URL. Разрешены только http/https; соединение —
 * только с публичными адресами (в том числе после редиректов).
 */
export async function fetchPublic(
  url: string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new UnsafeUrlError(`невалидный URL: ${url.slice(0, 100)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeUrlError(`схема ${parsed.protocol} не разрешена`)
  }

  // Литеральный IP в URL проверяем здесь, а не в резолвере диспетчера:
  // net.connect зовёт lookup только для доменных имён — резолвить нечего, и
  // проверка в lookup просто не выполнилась бы. Именно так
  // http://169.254.169.254/ (metadata облака) проходил насквозь.
  const host = parsed.hostname.replace(/^\[|\]$/g, '') // IPv6 приходит в скобках
  if (isIP(host) && isBlockedAddress(host)) {
    throw new UnsafeUrlError(`адрес ${host} непубличный`)
  }

  return (await undiciFetch(parsed.href, {
    headers: init.headers,
    signal: init.signal,
    redirect: 'follow',
    dispatcher: publicAgent(),
  })) as unknown as Response
}

/**
 * Прочитать не больше `maxBytes` из тела ответа и оборвать соединение. Нужен,
 * потому что `Range` — просьба, а не гарантия: сервер вправе её проигнорировать и
 * прислать сколь угодно большой файл, а `arrayBuffer()` покорно сложил бы его в
 * память.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < maxBytes) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  const out = new Uint8Array(Math.min(size, maxBytes))
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= out.length) break
    out.set(chunk.subarray(0, out.length - offset), offset)
    offset += chunk.length
  }
  return out
}
