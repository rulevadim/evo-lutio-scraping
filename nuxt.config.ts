import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  devtools: { enabled: true },

  // UnoCSS подключён вторым движком утилит — «поиграться потом».
  // Основная вёрстка ведётся на Tailwind (см. app/assets/css/main.css).
  modules: ['@unocss/nuxt'],

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  nitro: {
    // Нативный модуль — не бандлим, оставляем внешним.
    externals: {
      external: ['better-sqlite3'],
    },
  },
})
