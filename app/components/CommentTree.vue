<script setup lang="ts">
import type { CommentNode } from '~/composables/comments'

defineProps<{ nodes: CommentNode[] }>()

function fmt(ts: number): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <ul class="space-y-3">
    <li
      v-for="n in nodes"
      :id="`c${n.id}`"
      :key="n.id"
      class="scroll-mt-20 rounded-lg border border-neutral-200 bg-white p-3"
      :class="n.author === 'evo_lutio' ? 'ring-1 ring-amber-300' : ''"
    >
      <div class="mb-1 flex items-baseline gap-2 text-sm">
        <a
          v-if="n.authorJournal"
          :href="n.authorJournal"
          target="_blank"
          class="font-medium"
          :class="n.author === 'evo_lutio' ? 'text-amber-700' : 'text-neutral-800 hover:underline'"
        >
          {{ n.author || 'аноним' }}
        </a>
        <span v-else class="font-medium text-neutral-800">{{ n.author || 'аноним' }}</span>
        <span class="text-xs text-neutral-400">{{ fmt(n.createdAt) }}</span>
      </div>

      <div class="rich text-[0.95rem] leading-relaxed text-neutral-800" v-html="n.bodyHtml" />

      <CommentTree
        v-if="n.children.length"
        :nodes="n.children"
        class="mt-3 border-l-2 border-neutral-100 pl-3 sm:pl-4"
      />
    </li>
  </ul>
</template>
