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

// Скрейпинг: докачка старых постов из архива и загрузка свежего хвоста.
const scraping = ref(false)
const scrapeMsg = ref('')

async function runScrape(url: string, body: Record<string, number>, ok: (posts: number) => string) {
  scraping.value = true
  scrapeMsg.value = ''
  try {
    const res = await $fetch<{ posts: number; comments: number }>(url, { method: 'POST', body })
    scrapeMsg.value = ok(res.posts)
    await refresh()
  } catch {
    scrapeMsg.value = 'Не удалось загрузить. Попробуйте ещё раз.'
  } finally {
    scraping.value = false
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
          <div class="flex flex-wrap justify-center gap-2">
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
          </div>
          <p v-if="scraping" class="text-xs text-neutral-400">Загружаем…</p>
          <p v-else-if="scrapeMsg" class="text-xs text-neutral-500">{{ scrapeMsg }}</p>
        </div>
      </template>
    </section>
  </div>
</template>
