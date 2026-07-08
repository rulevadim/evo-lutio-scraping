<script setup lang="ts">
const props = defineProps<{ page: number; total: number }>()
const emit = defineEmits<{ 'update:page': [value: number] }>()

// Список страниц с «окном» вокруг текущей и многоточиями для длинных списков.
const items = computed<(number | '…')[]>(() => {
  const { page, total } = props
  const wanted = new Set([1, total, page - 1, page, page + 1])
  const pages = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)

  const out: (number | '…')[] = []
  let prev = 0
  for (const p of pages) {
    if (p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
})

function go(p: number) {
  if (p >= 1 && p <= props.total && p !== props.page) emit('update:page', p)
}
</script>

<template>
  <nav v-if="total > 1" class="flex flex-wrap items-center gap-1 text-sm">
    <button
      type="button"
      class="rounded px-2.5 py-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
      :disabled="page <= 1"
      @click="go(page - 1)"
    >
      ←
    </button>

    <template v-for="(it, i) in items" :key="i">
      <span v-if="it === '…'" class="px-1.5 text-neutral-400">…</span>
      <button
        v-else
        type="button"
        class="min-w-[2rem] rounded px-2.5 py-1"
        :class="it === page ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-100'"
        @click="go(it)"
      >
        {{ it }}
      </button>
    </template>

    <button
      type="button"
      class="rounded px-2.5 py-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
      :disabled="page >= total"
      @click="go(page + 1)"
    >
      →
    </button>
  </nav>
</template>
