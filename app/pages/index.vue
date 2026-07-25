<script setup lang="ts">
interface PostListItem {
  id: number
  title: string
  publishedAt: number
  tags: string[]
  commentCount: number
}

interface PostsPage {
  page: number
  totalPages: number
  total: number
  posts: PostListItem[]
}

interface SearchResult {
  kind: 'post' | 'comment'
  postId: number
  postTitle: string
  author: string
  snippet: string
  createdAt: number // дата поста или коммента, в котором нашлось слово
  href: string
}

const route = useRoute()
const router = useRouter()

const page = ref(Math.max(1, Number(route.query.page) || 1))
const { data, pending, refresh } = await useFetch<PostsPage>('/api/posts', {
  query: { page },
})

// Сервер клампит страницу — синхронизируем локальное значение с фактическим.
watch(data, (d) => {
  if (d && d.page !== page.value) page.value = d.page
})

// Смена страницы: обновляем URL и прокручиваем вверх.
watch(page, (p) => {
  router.replace({ query: { ...route.query, page: p } })
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
})

interface SearchResponse {
  page: number
  totalPages: number
  total: number
  results: SearchResult[]
}

const q = ref('')
const results = ref<SearchResult[]>([])
const searching = ref(false)
const sort = ref<'relevance' | 'date_desc' | 'date_asc'>('relevance')
const searchPage = ref(1)
const searchTotal = ref(0)
const searchTotalPages = ref(1)
const active = computed(() => q.value.trim().length >= 3)

function resetSearch() {
  results.value = []
  searchTotal.value = 0
  searchTotalPages.value = 1
}

async function runSearch() {
  if (!active.value) {
    resetSearch()
    return
  }
  searching.value = true
  try {
    const res = await $fetch<SearchResponse>('/api/search', {
      query: { q: q.value.trim(), sort: sort.value, page: searchPage.value },
    })
    results.value = res.results
    searchTotal.value = res.total
    searchTotalPages.value = res.totalPages
    if (res.page !== searchPage.value) searchPage.value = res.page // сервер клампит страницу
  } finally {
    searching.value = false
  }
}

// Смена страницы результатов поиска.
function goSearchPage(p: number) {
  searchPage.value = p
  runSearch()
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(timer)
  searchPage.value = 1 // новый запрос — с первой страницы
  if (!active.value) {
    resetSearch()
    return
  }
  timer = setTimeout(runSearch, 250)
})
// Смена сортировки — на первую страницу и сразу перезапрос (без debounce набора).
watch(sort, () => {
  searchPage.value = 1
  if (active.value) runSearch()
})

// Скрейпинг: докачка старых/новых постов со стримингом прогресса (NDJSON).
const scraping = ref(false)
const scrapeMsg = ref('')
const progress = ref<{ done: number; total: number } | null>(null)
const scan = ref<{ done: number; total: number } | null>(null) // фаза обхода архива (докачка пропущенных)
const oldCount = ref(20) // выбранное число для «Загрузить старые» (≥1, без потолка)
const aggressive = ref(false) // агрессивный режим: без пауз + параллельно (жёстко к ЖЖ)
const blogStats = useBlogStats()

interface ScrapeEvent {
  type: 'scan' | 'start' | 'progress' | 'done' | 'error'
  total?: number
  done?: number
  posts?: number
  comments?: number
  message?: string
}

// Прочитать NDJSON-поток скрейпа построчно, вызывая onEvent на каждое событие.
async function readScrapeStream(
  url: string,
  body: Record<string, number | boolean>,
  onEvent: (e: ScrapeEvent) => void,
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.body) throw new Error('Пустой ответ')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) onEvent(JSON.parse(line) as ScrapeEvent)
    }
  }
  const tail = buf.trim()
  if (tail) onEvent(JSON.parse(tail) as ScrapeEvent)
}

async function runScrape(
  url: string,
  body: Record<string, number | boolean>,
  ok: (posts: number) => string,
) {
  scraping.value = true
  scrapeMsg.value = ''
  progress.value = null
  scan.value = null
  let posts = 0
  try {
    await readScrapeStream(url, body, (e) => {
      if (e.type === 'scan') scan.value = { done: e.done ?? 0, total: e.total ?? 0 }
      else if (e.type === 'start') {
        scan.value = null // скан закончился — начинается собственно загрузка
        progress.value = { done: 0, total: e.total ?? 0 }
      } else if (e.type === 'progress') progress.value = { done: e.done ?? 0, total: e.total ?? 0 }
      else if (e.type === 'done') posts = e.posts ?? 0
      else if (e.type === 'error') throw new Error(e.message ?? 'Ошибка')
    })
    scrapeMsg.value = ok(posts)
    await refresh()
    await blogStats.refresh() // обновить счётчик «сохранено» в шапке
  } catch {
    scrapeMsg.value = 'Не удалось загрузить. Попробуйте ещё раз.'
  } finally {
    scraping.value = false
    progress.value = null
    scan.value = null
  }
}

const loadNewer = () =>
  runScrape('/api/scrape/newer', { count: 10, aggressive: aggressive.value }, (n) =>
    n ? `Добавлено ${n} новых постов (в начале списка).` : 'Новее сохранённых постов нет.',
  )

const loadMore = () =>
  runScrape('/api/scrape/more', { count: 10, aggressive: aggressive.value }, (n) =>
    n ? `Добавлено ${n} постов (они в конце списка).` : 'Новых старых постов не найдено.',
  )

const loadOld = () => {
  const count = Math.max(Math.trunc(oldCount.value) || 1, 1)
  oldCount.value = count
  return runScrape('/api/scrape/more', { count, aggressive: aggressive.value }, (n) =>
    n ? `Добавлено ${n} старых постов (они в конце списка).` : 'Новых старых постов не найдено.',
  )
}

const scrapeLatest = () =>
  runScrape('/api/scrape', { limit: 10, aggressive: aggressive.value }, (n) => `Загружено ${n} постов.`)

const loadMissing = () =>
  runScrape('/api/scrape/missing', { aggressive: aggressive.value }, (n) =>
    n ? `Докачано ${n} пропущенных постов.` : 'Пропущенных постов нет — всё на месте.',
  )

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
</script>

<template>
  <div>
    <div class="mb-8">
      <input
        v-model="q"
        type="search"
        placeholder="Поиск по постам и комментариям (от 3 символов)…"
        class="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-500"
      >
    </div>

    <!-- Результаты поиска -->
    <section v-if="active">
      <div class="mb-3 flex items-center justify-between gap-3">
        <p class="text-sm text-neutral-500">
          <span v-if="searching">Ищем…</span>
          <span v-else>Найдено: {{ searchTotal }}</span>
        </p>
        <label class="flex shrink-0 items-center gap-1.5 text-xs text-neutral-500">
          Сортировка:
          <select
            v-model="sort"
            class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 outline-none focus:border-neutral-500"
          >
            <option value="relevance">по релевантности</option>
            <option value="date_desc">сначала новые</option>
            <option value="date_asc">сначала старые</option>
          </select>
        </label>
      </div>
      <ul class="space-y-2">
        <li
          v-for="(r, i) in results"
          :key="i"
          class="rounded-lg border border-neutral-200 bg-white p-3"
        >
          <NuxtLink :to="r.href" class="block">
            <div class="mb-1 flex items-center gap-2 text-xs">
              <span
                class="shrink-0 rounded px-1.5 py-0.5 font-medium"
                :class="r.kind === 'post' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'"
              >
                {{ r.kind === 'post' ? 'пост' : 'коммент' }}
              </span>
              <span class="min-w-0 truncate text-neutral-500">
                {{ r.postTitle }}<template v-if="r.author"> · {{ r.author }}</template>
              </span>
              <span v-if="r.createdAt" class="ml-auto shrink-0 text-neutral-400">
                {{ fmtDate(r.createdAt) }}
              </span>
            </div>
            <p class="text-sm text-neutral-700">{{ r.snippet }}</p>
          </NuxtLink>
        </li>
      </ul>

      <div v-if="searchTotalPages > 1" class="mt-4 flex justify-center">
        <Pagination :page="searchPage" :total="searchTotalPages" @update:page="goSearchPage" />
      </div>

      <p v-if="!searching && results.length === 0" class="text-sm text-neutral-400">
        Ничего не найдено.
      </p>
    </section>

    <!-- Список постов -->
    <section v-else>
      <h1 class="mb-4 text-xl font-semibold">Последние посты</h1>
      <p v-if="pending" class="text-sm text-neutral-400">Загрузка…</p>

      <!-- Пусто: предложить первый скрейп -->
      <div v-else-if="!data?.posts.length" class="space-y-3">
        <p class="text-sm text-neutral-500">Постов пока нет.</p>
        <button
          type="button"
          class="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:border-neutral-500 disabled:opacity-50"
          :disabled="scraping"
          @click="scrapeLatest"
        >
          {{ scraping ? 'Загружаем…' : 'Скрейпить последние посты' }}
        </button>
        <p v-if="scrapeMsg" class="text-xs text-neutral-500">{{ scrapeMsg }}</p>
      </div>

      <template v-else>
        <ul class="space-y-2">
          <li
            v-for="post in data.posts"
            :key="post.id"
            class="rounded-lg border border-neutral-200 bg-white transition hover:border-neutral-400"
          >
            <NuxtLink :to="`/posts/${post.id}`" class="block px-4 py-3">
              <h2 class="font-medium">{{ post.title }}</h2>
              <div class="mt-1 flex items-center gap-3 text-xs text-neutral-500">
                <span>{{ fmtDate(post.publishedAt) }}</span>
                <span>· {{ post.commentCount }} комм.</span>
              </div>
            </NuxtLink>
          </li>
        </ul>

        <div class="mt-6 flex flex-col items-center gap-3">
          <Pagination :page="page" :total="data.totalPages" @update:page="(p) => (page = p)" />
          <div class="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              class="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:border-neutral-500 disabled:opacity-50"
              :disabled="scraping"
              @click="loadNewer"
            >
              Загрузить новые посты
            </button>
            <button
              type="button"
              class="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:border-neutral-500 disabled:opacity-50"
              :disabled="scraping"
              @click="loadMore"
            >
              Ещё 10 постов из архива
            </button>
            <span class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white py-1 pl-1.5 pr-1">
              <input
                v-model.number="oldCount"
                type="number"
                min="1"
                :disabled="scraping"
                class="w-16 rounded border border-neutral-200 px-2 py-1 text-center text-sm tabular-nums outline-none focus:border-neutral-400 disabled:opacity-50"
                @keydown.enter="loadOld"
              >
              <button
                type="button"
                class="rounded-md px-2.5 py-1 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
                :disabled="scraping"
                @click="loadOld"
              >
                Загрузить старые
              </button>
            </span>
            <button
              type="button"
              class="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm hover:border-neutral-500 disabled:opacity-50"
              :disabled="scraping"
              title="Обойти архив и докачать все посты, которых нет в базе (закрывает дырки в любом месте)"
              @click="loadMissing"
            >
              Докачать пропущенные
            </button>
            <label
              class="inline-flex cursor-pointer items-center gap-1.5 text-sm text-neutral-600"
              title="Без пауз и параллельно — быстрее, но жёстче к ЖЖ (риск временного троттлинга/бана)"
            >
              <input
                v-model="aggressive"
                type="checkbox"
                :disabled="scraping"
                class="h-4 w-4 accent-neutral-800 disabled:opacity-50"
              >
              агрессивно
            </label>
          </div>

          <!-- Прогресс загрузки: реально видно, сколько постов из скольких -->
          <div v-if="scraping" class="w-full max-w-xs">
            <template v-if="scan">
              <div class="mb-1 flex justify-between text-xs text-neutral-500">
                <span>Сканируем архив…</span>
                <span class="tabular-nums">{{ scan.done }} / {{ scan.total }} лет</span>
              </div>
              <div class="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                <div
                  class="h-full rounded-full bg-neutral-500 transition-all duration-300"
                  :style="{ width: (scan.total ? (scan.done / scan.total) * 100 : 0) + '%' }"
                />
              </div>
            </template>
            <template v-else-if="progress && progress.total">
              <div class="mb-1 flex justify-between text-xs text-neutral-500">
                <span>Загружаем посты…</span>
                <span class="tabular-nums">{{ progress.done }} / {{ progress.total }}</span>
              </div>
              <div class="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                <div
                  class="h-full rounded-full bg-neutral-800 transition-all duration-300"
                  :style="{ width: (progress.done / progress.total) * 100 + '%' }"
                />
              </div>
            </template>
            <p v-else class="text-center text-xs text-neutral-400">Готовим список…</p>
          </div>
          <p v-else-if="scrapeMsg" class="text-xs text-neutral-500">{{ scrapeMsg }}</p>
        </div>
      </template>
    </section>
  </div>
</template>
