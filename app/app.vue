<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'ru' },
  title: 'Эволюция — читалка',
})
</script>

<template>
  <div class="min-h-screen bg-neutral-50 text-neutral-900">
    <header class="border-b border-neutral-200 bg-white">
      <div class="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <NuxtLink to="/" class="text-lg font-semibold tracking-tight">
          evo·lutio <span class="text-neutral-400">/ читалка</span>
        </NuxtLink>
        <a
          href="https://evo-lutio.livejournal.com/"
          target="_blank"
          class="text-sm text-neutral-500 hover:text-neutral-900"
        >
          оригинал ↗
        </a>
      </div>
    </header>

    <main class="mx-auto max-w-3xl px-4 py-8">
      <NuxtPage />
    </main>
  </div>
</template>
