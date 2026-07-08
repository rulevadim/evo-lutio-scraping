<script setup lang="ts">
import type { FlatComment } from '~/composables/comments'

interface PostData {
  post: {
    id: number
    url: string
    title: string
    publishedAt: number
    tags: string[]
    bodyHtml: string
  }
  comments: FlatComment[]
}

const route = useRoute()
const { data, error } = await useFetch<PostData>(`/api/posts/${route.params.id}`)

const tree = computed(() => buildCommentTree(data.value?.comments ?? []))

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

useHead(() => ({ title: data.value?.post.title ?? 'Пост' }))
</script>

<template>
  <div>
    <NuxtLink to="/" class="mb-6 inline-block text-sm text-neutral-500 hover:text-neutral-900">
      ← к списку
    </NuxtLink>

    <div v-if="error" class="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
      Не удалось загрузить пост.
    </div>

    <article v-else-if="data">
      <header class="mb-6">
        <h1 class="text-2xl font-semibold leading-tight">{{ data.post.title }}</h1>
        <div class="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
          <span>{{ fmtDate(data.post.publishedAt) }}</span>
          <a :href="data.post.url" target="_blank" class="hover:text-neutral-900">оригинал ↗</a>
        </div>
      </header>

      <div class="rich text-[1.05rem] leading-relaxed text-neutral-900" v-html="data.post.bodyHtml" />

      <section class="mt-10">
        <h2 class="mb-4 text-lg font-semibold">
          Комментарии
          <span class="text-sm font-normal text-neutral-400">({{ data.comments.length }})</span>
        </h2>
        <p v-if="!data.comments.length" class="text-sm text-neutral-400">Комментариев нет.</p>
        <CommentTree v-else :nodes="tree" />
      </section>
    </article>
  </div>
</template>
