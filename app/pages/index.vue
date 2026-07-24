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

const q = ref('')
const results = ref<SearchResult[]>([])
const searching = ref(false)
const active = computed(() => q.value.trim().length >= 3)

let timer: ReturnType<typeof setTimeout> | undefined
watch(q, (val) => {
  clearTimeout(timer)
  if (val.trim().length < 3) {
    results.value = []
    return
  }
  timer = setTimeout(async () => {
    searching.value = true
    try {
      const res = await $fetch<{ results: SearchResult[] }>('/api/search', {
        query: { q: val },
      })
      results.value = res.results
    } finally {
      searching.value = false
    }
  }, 250)
})

// Скрейпинг: докачка старых/новых постов со стримингом прогресса (NDJSON).
const scraping = ref(false)
const scrapeMsg = ref('')
const progress = ref<{ done: number; total: number } | null>(null)
const oldCount = ref(20) // выбранное число для «Загрузить старые» (1..100)
const blogStats = useBlogStats()

interface ScrapeEvent {
  type: 'start' | 'progress' | 'done' | 'error'
  total?: number
  done?: number
  posts?: number
  comments?: number
  message?: string
}

// Прочитать NDJSON-поток скрейпа построчно, вызывая onEvent на каждое событие.
async function readScrapeStream(
  url: string,
  body: Record<string, number>,
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

async function runScrape(url: string, body: Record<string, number>, ok: (posts: number) => string) {
  scraping.value = true
  scrapeMsg.value = ''
  progress.value = null
  let posts = 0
  try {
    await readScrapeStream(url, body, (e) => {
      if (e.type === 'start') progress.value = { done: 0, total: e.total ?? 0 }
      else if (e.type === 'progress') progress.value = { done: e.done ?? 0, total: e.total ?? 0 }
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
  }
}

const loadNewer = () =>
  runScrape('/api/scrape/newer', { count: 10 }, (n) =>
    n ? `Добавлено ${n} новых постов (в начале списка).` : 'Новее сохранённых постов нет.',
  )

const loadMore = () =>
  runScrape('/api/scrape/more', { count: 10 }, (n) =>
    n ? `Добавлено ${n} постов (они в конце списка).` : 'Новых старых постов не найдено.',
  )

const loadOld = () => {
  const count = Math.min(Math.max(Math.trunc(oldCount.value) || 1, 1), 100)
  oldCount.value = count
  return runScrape('/api/scrape/more', { count }, (n) =>
    n ? `Добавлено ${n} старых постов (они в конце списка).` : 'Новых старых постов не найдено.',
  )
}

const scrapeLatest = () =>
  runScrape('/api/scrape', { limit: 10 }, (n) => `Загружено ${n} постов.`)

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
      <p class="mb-3 text-sm text-neutral-500">
        <span v-if="searching">Ищем…</span>
        <span v-else>Найдено: {{ results.length }}</span>
      </p>
      <ul class="space-y-2">
        <li
          v-for="(r, i) in results"
          :key="i"
          class="rounded-lg border border-neutral-200 bg-white p-3"
        >
          <NuxtLink :to="r.href" class="block">
            <div class="mb-1 flex items-center gap-2 text-xs">
              <span
                class="rounded px-1.5 py-0.5 font-medium"
                :class="r.kind === 'post' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'"
              >
                {{ r.kind === 'post' ? 'пост' : 'коммент' }}
              </span>
              <span class="truncate text-neutral-500">
                {{ r.postTitle }}<template v-if="r.author"> · {{ r.author }}</template>
              </span>
            </div>
            <p class="text-sm text-neutral-700">{{ r.snippet }}</p>
          </NuxtLink>
        </li>
      </ul>
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
                max="100"
                :disabled="scraping"
                class="w-14 rounded border border-neutral-200 px-2 py-1 text-center text-sm tabular-nums outline-none focus:border-neutral-400 disabled:opacity-50"
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
          </div>

          <!-- Прогресс загрузки: реально видно, сколько постов из скольких -->
          <div v-if="scraping" class="w-full max-w-xs">
            <template v-if="progress && progress.total">
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
