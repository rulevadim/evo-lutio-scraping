import { describe, expect, it } from 'vitest'
import { safeExternalUrl, sanitizeLjHtml } from './sanitize'

/** Опасен не сам тег, а «живой» источник: iframe без src ничего не грузит. */
const looksDangerous = (html: string) =>
  /on\w+\s*=|javascript:|<script|<object|<embed|<form|<base|xlink|style=|data:text/i.test(html) ||
  /<iframe[^>]*\bsrc\s*=/i.test(html)

describe('sanitizeLjHtml: атаки', () => {
  it.each([
    ['обработчик onerror', '<img src=x onerror="alert(1)">'],
    ['обработчик onclick', '<span onclick="alert(1)">т</span>'],
    ['script вместе с телом', '<p>до</p><script>alert(1)</script><p>после</p>'],
    ['javascript: в href', '<a href="javascript:alert(1)">клик</a>'],
    ['data: в src картинки', '<img src="data:text/html;base64,PHNjcmlwdD4=">'],
    ['iframe с чужого домена', '<iframe src="https://evil.example/x"></iframe>'],
    ['iframe с javascript:', '<iframe src="javascript:alert(1)"></iframe>'],
    ['svg use с xlink', '<svg><use xlink:href="https://evil.example/x#a"/></svg>'],
    ['object и embed', '<object data="x"><embed src="y"></object>'],
    ['форма', '<form action="https://evil.example"><input name="a"></form>'],
    ['url() внутри style', '<div style="background:url(javascript:alert(1))">т</div>'],
    ['подмена base', '<base href="https://evil.example/">'],
    ['iframe с srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ])('вырезает: %s', (_name, html) => {
    expect(looksDangerous(sanitizeLjHtml(html))).toBe(false)
  })

  it('вырезает содержимое script, а не только теги', () => {
    // Ключевой момент: htmlToText оставил бы «alert(1)» в тексте и в FTS.
    expect(sanitizeLjHtml('<script>alert(1)</script>')).not.toContain('alert')
  })
})

describe('sanitizeLjHtml: контент выживает', () => {
  it('сохраняет видео с YouTube', () => {
    const out = sanitizeLjHtml(
      '<iframe width="640" height="360" frameborder="0" allowfullscreen src="https://www.youtube.com/embed/abc"></iframe>',
    )
    expect(out).toMatch(/<iframe[^>]+youtube\.com\/embed\/abc/)
  })

  it('сохраняет размеры картинки, вписанные reserveImgSpace', () => {
    // Без этого бэкофилл снял бы width/height и вернул layout shift.
    const out = sanitizeLjHtml(
      '<img src="https://ic.pics.livejournal.com/a.jpg" width="600" height="400" loading="lazy" decoding="async">',
    )
    expect(out).toContain('width="600"')
    expect(out).toContain('height="400"')
    expect(out).toContain('loading="lazy"')
  })

  it('сохраняет разметку бейджа <lj user>', () => {
    const out = sanitizeLjHtml(
      '<span class="ljuser i-ljuser" data-ljuser="flile" lj:user="flile"><img class="i-ljuser-userhead" src="https://l-stat.livejournal.net/x.png"></span>',
    )
    expect(out).toContain('data-ljuser="flile"')
    expect(out).toContain('lj:user="flile"')
    expect(out).toContain('class="i-ljuser-userhead"')
  })

  it('поднимает protocol-relative URL до https', () => {
    expect(sanitizeLjHtml('<img src="//ic.pics.livejournal.com/a.jpg">')).toContain(
      'src="https://ic.pics.livejournal.com/a.jpg"',
    )
  })

  it('сохраняет таблицы, списки и цитаты', () => {
    expect(sanitizeLjHtml('<table border="1"><tr><td align="left">я</td></tr></table>')).toContain(
      '<td align="left">я</td>',
    )
    expect(sanitizeLjHtml('<blockquote class="c"><ul><li>раз</li></ul></blockquote>')).toContain(
      '<li>раз</li>',
    )
  })

  it('добавляет rel к ссылкам с target', () => {
    // target="_blank" без noopener даёт открытой вкладке доступ к window.opener.
    expect(sanitizeLjHtml('<a href="https://x.test" target="_blank">t</a>')).toContain(
      'rel="noopener noreferrer"',
    )
  })
})

describe('sanitizeLjHtml: идемпотентность', () => {
  it.each([
    '<a href="https://x.test" target="_blank">t</a>',
    '<img src="//host.test/a.jpg" width="10" height="20">',
    '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
    '<p>обычный <b>текст</b></p>',
  ])('повторный прогон ничего не меняет: %s', (html) => {
    // На этом держатся и повторный скрейп, и повторный запуск бэкофилла.
    const once = sanitizeLjHtml(html)
    expect(sanitizeLjHtml(once)).toBe(once)
  })
})

describe('safeExternalUrl', () => {
  it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'не-url', '', null])(
    'отбрасывает %s',
    (input) => {
      expect(safeExternalUrl(input as string | null)).toBe('')
    },
  )

  it('пропускает http и https', () => {
    expect(safeExternalUrl('https://flile.livejournal.com/')).toBe('https://flile.livejournal.com/')
    expect(safeExternalUrl('http://x.test/a')).toBe('http://x.test/a')
  })

  it('поднимает protocol-relative до https', () => {
    expect(safeExternalUrl('//flile.livejournal.com/')).toBe('https://flile.livejournal.com/')
  })
})
