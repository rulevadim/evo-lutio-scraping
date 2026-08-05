import { imageSize } from 'image-size'
import { runPool } from '../pool'
import { fetchPublic, readCapped } from '../safe-fetch'

// Резервирование места под картинки, чтобы не было layout shift.
// Размеры добывает СЕРВЕР (у браузера кросс-доменный CORS не даёт читать байты CDN),
// на скрейпе, и кэширует в памяти процесса.
//
// `src` здесь — недоверенный: его задаёт автор поста или коммента. Поэтому ходим
// через `fetchPublic` (только http/https, только публичные адреса, редиректы
// проверяются тем же диспетчером) и читаем ограниченный кусок тела.

interface Dims {
  w: number
  h: number
}

const dimsCache = new Map<string, Dims | null>()

/** Больше заголовка не нужно: размеры лежат в первых байтах любого формата. */
const MAX_PROBE_BYTES = 64 * 1024
/** Картинок в посте бывает много — не открываем на каждую по соединению. */
const PROBE_CONCURRENCY = 4

// Статические ассеты ЖЖ (иконки <lj user> и т.п.) — не пробим, размер даёт CSS.
const SKIP_HOSTS = ['l-stat.livejournal.net']

function shouldSkip(url: string): boolean {
  return SKIP_HOSTS.some((h) => url.includes(h))
}

/** Узнать размеры картинки, скачав только заголовок (Range). null при неудаче. */
async function probeImageSize(url: string): Promise<Dims | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetchPublic(url, {
      headers: {
        Range: `bytes=0-${MAX_PROBE_BYTES - 1}`,
        'User-Agent': 'evo-lutio-reader/0.1',
      },
      signal: controller.signal,
    })
    if (!res.ok && res.status !== 206) return null
    // Именно readCapped, а не arrayBuffer: сервер вправе проигнорировать Range.
    const buf = await readCapped(res, MAX_PROBE_BYTES)
    if (!buf.length) return null
    const { width, height } = imageSize(buf)
    return width && height ? { w: width, h: height } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Достать size из кэша либо пробить (с записью в кэш). */
async function resolveDims(url: string): Promise<Dims | null> {
  if (dimsCache.has(url)) return dimsCache.get(url)!
  const dims = await probeImageSize(url)
  dimsCache.set(url, dims)
  return dims
}

/**
 * Вписать в HTML размеры контент-картинок (+ ленивую загрузку), чтобы браузер
 * зарезервировал место под них. Размеры берутся из кэша/пробинга. Идемпотентно.
 */
export async function reserveImgSpace(html: string): Promise<string> {
  if (!html || !html.includes('<img')) return html

  const tags = html.match(/<img\b[^>]*>/gi) ?? []
  const urls = new Set<string>()
  for (const tag of tags) {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]
    if (src && !shouldSkip(src)) urls.add(src)
  }
  if (!urls.size) return html

  // Пробиваем недостающие размеры пулом: в посте бывает несколько десятков
  // картинок, и открывать на каждую своё соединение незачем.
  await runPool([...urls], PROBE_CONCURRENCY, async (u) => {
    await resolveDims(u)
  })

  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]
    if (!src || shouldSkip(src)) return tag
    const dims = dimsCache.get(src)

    let out = tag
    if (dims && !/\bwidth=/i.test(out)) {
      out = out.replace(/<img\b/i, `<img width="${dims.w}" height="${dims.h}"`)
    }
    if (!/\bloading=/i.test(out)) out = out.replace(/<img\b/i, '<img loading="lazy"')
    if (!/\bdecoding=/i.test(out)) out = out.replace(/<img\b/i, '<img decoding="async"')
    return out
  })
}
