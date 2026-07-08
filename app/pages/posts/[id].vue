<script setup lang="ts">
import type { FlatComment } from '~/composables/comments'

interface PostMeta {
  post: {
    id: number
    url: string
    title: string
    publishedAt: number
    tags: string[]
    bodyHtml: string
  }
  commentCount: number
}

interface CommentsPage {
  page: number
  totalPages: number
  totalTop: number
  comments: FlatComment[]
}

const route = useRoute()
const router = useRouter()
const id = route.params.id as string

const page = ref(Math.max(1, Number(route.query.page) || 1))
const commentsSection = ref<HTMLElement | null>(null)

const { data: meta, error } = await useFetch<PostMeta>(`/api/posts/${id}`)
const { data: cdata } = await useFetch<CommentsPage>(`/api/posts/${id}/comments`, {
  query: { page },
})

const tree = computed(() => buildCommentTree(cdata.value?.comments ?? []))

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// Сервер клампит страницу — синхронизируем локальное значение с фактическим.
watch(cdata, (d) => {
  if (d && d.page !== page.value) page.value = d.page
})

// Смена страницы: обновляем URL и прокручиваем к началу комментариев.
watch(page, (p) => {
  router.replace({ query: { ...route.query, page: p, q: undefined }, hash: '' })
  if (import.meta.client) {
    requestAnimationFrame(() => commentsSection.value?.scrollIntoView({ behavior: 'smooth' }))
  }
})

const HIGHLIGHT_MS = 5000

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Обернуть целые слова из запроса в <mark> внутри контейнера. Возвращает первый <mark>.
function markWords(container: HTMLElement, query: string): HTMLElement | null {
  const words = query.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2)
  if (!words.length) return null
  // Границы слова через \p{L}\p{N} (JS \b не дружит с кириллицей).
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  )

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    re.lastIndex = 0
    if (n.nodeValue && re.test(n.nodeValue)) nodes.push(n as Text)
  }

  let first: HTMLElement | null = null
  for (const node of nodes) {
    const text = node.nodeValue!
    const frag = document.createDocumentFragment()
    let last = 0
    re.lastIndex = 0
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
      const mark = document.createElement('mark')
      mark.className = 'search-hit'
      mark.textContent = m[0]
      frag.appendChild(mark)
      if (!first) first = mark
      last = m.index + m[0].length
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    node.parentNode?.replaceChild(frag, node)
  }
  return first
}

function unmark(container: HTMLElement): void {
  container.querySelectorAll('mark.search-hit').forEach((m) => {
    m.replaceWith(document.createTextNode(m.textContent ?? ''))
  })
  container.normalize()
}

// Прокрутить так, чтобы элемент оказался по центру экрана по вертикали.
function centerOn(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  const top = window.scrollY + rect.top - window.innerHeight / 2 + rect.height / 2
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

// Дождаться загрузки картинок в области (иначе лейаут сдвинется после скролла).
function waitForImages(scope: ParentNode, timeoutMs = 1500): Promise<void> {
  const imgs = [...scope.querySelectorAll('img')].filter((im) => !im.complete)
  if (!imgs.length) return Promise.resolve()
  return Promise.race([
    Promise.all(
      imgs.map(
        (im) =>
          new Promise<void>((res) => {
            im.addEventListener('load', () => res(), { once: true })
            im.addEventListener('error', () => res(), { once: true })
          }),
      ),
    ).then(() => undefined),
    new Promise<void>((res) => setTimeout(res, timeoutMs)),
  ])
}

// Переход из поиска: подсветить слово(а) из ?q= и прокрутить к первому совпадению.
function highlightFromSearch() {
  if (!import.meta.client) return
  const q = String(route.query.q ?? '')

  requestAnimationFrame(() => {
    // Целевой контейнер: тело нужного комментария (по #c…) либо тело поста.
    const container = route.hash
      ? (document.querySelector<HTMLElement>(`${route.hash} .rich`) ??
        document.querySelector<HTMLElement>(route.hash))
      : document.getElementById('post-body')
    if (!container) return

    const first = q ? markWords(container, q) : null
    const scrollTarget =
      first ?? (route.hash ? document.querySelector<HTMLElement>(route.hash) : container)
    if (!scrollTarget) return

    // Центрируем сразу и ещё раз после загрузки картинок поста (лейаут сдвигается).
    centerOn(scrollTarget)
    void waitForImages(document.querySelector('article') ?? document.body).then(() =>
      centerOn(scrollTarget),
    )

    if (first) {
      setTimeout(() => {
        container.querySelectorAll('mark.search-hit').forEach((m) => m.classList.add('fade'))
        setTimeout(() => unmark(container), 500)
      }, HIGHLIGHT_MS)
    }
  })
}

onMounted(highlightFromSearch)

useHead(() => ({ title: meta.value?.post.title ?? 'Пост' }))
</script>

<template>
  <div>
    <NuxtLink to="/" class="mb-6 inline-block text-sm text-neutral-500 hover:text-neutral-900">
      ← к списку
    </NuxtLink>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
      Не удалось загрузить пост.
    </div>

    <article v-else-if="meta">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold leading-tight">{{ meta.post.title }}</h1>
        <div class="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
          <span>{{ fmtDate(meta.post.publishedAt) }}</span>
          <a :href="meta.post.url" target="_blank" class="hover:text-neutral-900">оригинал ↗</a>
        </div>
      </header>

      <div id="post-body" class="rich text-[1.05rem] leading-relaxed text-neutral-900" v-html="meta.post.bodyHtml" />

      <section ref="commentsSection" class="mt-10 scroll-mt-20">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">
            Комментарии
            <span class="text-sm font-normal text-neutral-400">({{ meta.commentCount }})</span>
          </h2>
          <Pagination
            v-if="cdata"
            :page="page"
            :total="cdata.totalPages"
            @update:page="(p) => (page = p)"
          />
        </div>

        <p v-if="!cdata?.comments.length" class="text-sm text-neutral-400">Комментариев нет.</p>
        <CommentTree v-else :nodes="tree" />

        <div v-if="cdata && cdata.totalPages > 1" class="mt-6 flex justify-center">
          <Pagination :page="page" :total="cdata.totalPages" @update:page="(p) => (page = p)" />
        </div>
      </section>
    </article>
  </div>
</template>
