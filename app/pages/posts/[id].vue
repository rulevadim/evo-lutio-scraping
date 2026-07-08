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
  router.replace({ query: { ...route.query, page: p }, hash: '' })
  if (import.meta.client) {
    requestAnimationFrame(() => commentsSection.value?.scrollIntoView({ behavior: 'smooth' }))
  }
})

// Переход из поиска: подсветить и прокрутить к конкретному комментарию.
function highlightHash() {
  if (!import.meta.client || !route.hash) return
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(route.hash)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-amber-400')
    setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400'), 2200)
  })
}

onMounted(highlightHash)

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

      <div class="rich text-[1.05rem] leading-relaxed text-neutral-900" v-html="meta.post.bodyHtml" />

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
