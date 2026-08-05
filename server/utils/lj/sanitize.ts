import sanitizeHtml from 'sanitize-html'

// Санитизация HTML из ЖЖ.
//
// Зачем: тело поста и комментов выводится через `v-html`, а приходит оно из
// внешнего источника. Пока сайт локальный, это безобидно; на публичном сайте
// сохранённый `onerror` выполнился бы в браузере админа и дёрнул скрейп от его
// имени (httpOnly куку браузер приложит к same-origin запросу сам). Фильтрация на
// стороне ЖЖ — не наша граница безопасности.
//
// Allowlist выведен из данных, а не придуман: `scripts/analyze-html.mjs` снял
// частоты по 5746 постам и 300 917 комментам (37 тегов, 102 пары тег@атрибут).

/**
 * Версия правил. При изменении allowlist — увеличить: по ней бэкофилл понимает,
 * что базу надо прогнать заново, а healthcheck — что БД несанитизированная.
 */
export const HTML_SANITIZER_VERSION = 1

// 783 из 810 iframe в базе — YouTube, остальные тоже известные видеохостинги.
// Выкидывать их целиком значило бы потерять всё видео в блоге, поэтому вместо
// запрета — allowlist доменов (поддомены разрешены).
const ALLOWED_IFRAME_DOMAINS = [
  'youtube.com',
  'youtube-nocookie.com',
  'rutube.ru',
  'vimeo.com',
  'coub.com',
  'giphy.com',
  'instagram.com',
  'vk.com',
  'ok.ru',
  'yandex.ru',
  'rambler.ru',
  'mail.ru',
  'livejournal.com',
]

// `//host/path` — 310 штук в базе. `allowProtocolRelative: false` их бы выбросил
// вместе с картинками, поэтому доводим до https перед проверкой схемы.
function absolutize(url?: string): string | undefined {
  if (!url) return url
  return url.startsWith('//') ? `https:${url}` : url
}

const config: sanitizeHtml.IOptions = {
  allowedTags: [
    // текст и разметка
    'p', 'br', 'div', 'span', 'hr', 'wbr', 'center',
    'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'small', 'sup', 'sub', 'q',
    // ссылки и картинки
    'a', 'img',
    // списки и цитаты
    'ul', 'ol', 'li', 'blockquote',
    // таблицы
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'figure', 'figcaption',
    // декоративные иконки ЖЖ (svgicon). <use> НЕ разрешён — xlink:href умеет
    // тянуть внешний документ.
    'svg', 'path',
    // видео — только с доменов из ALLOWED_IFRAME_DOMAINS
    'iframe',
  ],

  allowedAttributes: {
    a: [
      'href', 'target', 'rel', 'class', 'name', 'title', 'hidden',
      'data-badge-type', 'data-placement', 'data-pro-badge', 'data-pro-badge-type',
      'data-is-raw', 'data-flickr-embed',
    ],
    // width/height/loading/decoding вписывает reserveImgSpace — они обязаны
    // пережить санитизацию, иначе бэкофилл вернёт layout shift.
    img: [
      'src', 'alt', 'title', 'width', 'height', 'class',
      'loading', 'decoding', 'fetchpriority', 'border',
    ],
    // бейджи <lj user>: без этих атрибутов ломается вёрстка .i-ljuser-userhead
    span: ['class', 'data-ljuser', 'lj:user'],
    div: ['class', 'align'],
    p: ['dir', 'class', 'lang'],
    blockquote: [
      'class', 'lang', 'lj-screenable',
      'data-instgrm-captioned', 'data-instgrm-version', 'data-telegram-post', 'data-width',
    ],
    figure: ['class', 'data-figure-type', 'data-image-type'],
    table: ['border'],
    td: ['align', 'valign'],
    th: ['align', 'valign'],
    svg: ['class', 'width', 'height', 'xmlns', 'viewbox'],
    path: ['d', 'fill-rule', 'clip-rule'],
    iframe: ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'allow', 'title', 'class'],
  },

  // Схемы задаются по тегам: глобальный mailto разрешил бы его и там, где он
  // не нужен. `data:` не разрешён нигде.
  allowedSchemes: ['http', 'https'],
  allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
  allowProtocolRelative: false,

  allowedIframeDomains: ALLOWED_IFRAME_DOMAINS,
  allowIframeRelativeUrls: false,

  // Содержимое этих тегов вырезается целиком, а не превращается в текст.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],

  // У iframe с чужого домена (или с javascript:) sanitize-html снимает src и
  // оставляет пустой <iframe></iframe> — он безвреден, но мусорит разметку.
  exclusiveFilter: (frame) => frame.tag === 'iframe' && !frame.attribs.src,

  transformTags: {
    a: (tagName, attribs) => {
      const out: Record<string, string> = { ...attribs }
      if (out.href) out.href = absolutize(out.href)!
      // target="_blank" без noopener даёт открытой вкладке доступ к window.opener
      if (out.target) out.rel = 'noopener noreferrer'
      return { tagName, attribs: out }
    },
    img: (tagName, attribs) => {
      const out: Record<string, string> = { ...attribs }
      if (out.src) out.src = absolutize(out.src)!
      return { tagName, attribs: out }
    },
    iframe: (tagName, attribs) => {
      const out: Record<string, string> = { ...attribs }
      if (out.src) out.src = absolutize(out.src)!
      return { tagName, attribs: out }
    },
  },
}

/**
 * Очистить HTML тела поста или коммента. Идемпотентна: повторный прогон уже
 * очищенного HTML ничего не меняет (на этом держится безопасность повторного
 * скрейпа и бэкофилла).
 *
 * Намеренно НЕ разрешены: атрибут `style` (sanitize-html не фильтрует URL внутри
 * CSS), `<use>`/`xlink:href`, `object`/`embed`/`param`, `srcset`/`sizes`/`ng-src`,
 * data-атрибуты сторонних JS-плееров.
 */
export function sanitizeLjHtml(html: string): string {
  if (!html) return ''
  return sanitizeHtml(html, config)
}

/**
 * Безопасный внешний URL для подстановки в `href` вне HTML-санитайзера
 * (`authorJournal` в CommentTree, пермалинк поста из RSS). Пустая строка — если
 * схема не http/https, чтобы `javascript:`/`data:` не доехали до атрибута.
 */
export function safeExternalUrl(url: string | null | undefined): string {
  if (!url) return ''
  const abs = absolutize(url.trim())!
  try {
    const parsed = new URL(abs)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : ''
  } catch {
    return ''
  }
}
