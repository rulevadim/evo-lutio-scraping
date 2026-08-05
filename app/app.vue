<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'ru' },
  title: 'Эволюция — читалка',
})

const { stats, counting, countError, ensureLoaded, count } = useBlogStats()
const { isAdmin, logout, refresh: refreshAdmin } = useAdmin()

onMounted(() => {
  ensureLoaded()
  // Кука могла истечь по maxAge или выход сделан в другой вкладке — сверяемся с
  // сервером при возврате на вкладку, иначе кнопки останутся видны «призраком».
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshAdmin()
  })
})

const countedTitle = computed(() => {
  if (stats.value?.countedAt) {
    return `Сохранено ${stats.value.scraped} из ${stats.value.total}. Подсчитано: ${new Date(
      stats.value.countedAt * 1000,
    ).toLocaleString('ru-RU')}`
  }
  // Анониму не предлагаем кнопку, которой он не видит.
  return isAdmin.value
    ? 'Общее число постов ещё не подсчитано — нажмите «Подсчитать»'
    : 'Общее число постов блога ещё не подсчитано'
})
</script>

<template>
  <div class="min-h-screen bg-neutral-50 text-neutral-900">
    <header class="border-b border-neutral-200 bg-white">
      <div class="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <NuxtLink to="/" class="text-lg font-semibold tracking-tight">
          evo·lutio <span class="text-neutral-400">/ читалка</span>
        </NuxtLink>

        <div class="flex items-center gap-2 text-sm sm:gap-3">
          <span class="tabular-nums text-neutral-500" :title="countedTitle">
            {{ stats?.scraped ?? '—' }}<span class="mx-0.5 text-neutral-300">/</span>{{ stats?.total ?? '?' }}
          </span>
          <!-- Пересчёт — это ~150 запросов к ЖЖ, только для админа. -->
          <template v-if="isAdmin">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-neutral-600 hover:border-neutral-500 disabled:opacity-50"
              :disabled="counting"
              :title="countError || (counting ? 'Обходим архив по месяцам…' : 'Посчитать все посты блога (займёт ~1–2 мин)')"
              @click="count"
            >
              <span
                v-if="counting"
                class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600"
              />
              {{ counting ? 'Считаем…' : 'Подсчитать' }}
            </button>
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-2.5 py-1 text-neutral-600 hover:border-neutral-500"
              title="Выйти из админки"
              @click="logout"
            >
              Выйти
            </button>
          </template>
          <a
            href="https://evo-lutio.livejournal.com/"
            target="_blank"
            class="hidden text-neutral-500 hover:text-neutral-900 sm:inline"
          >
            оригинал ↗
          </a>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-3xl px-4 py-8">
      <NuxtPage />
    </main>
  </div>
</template>
