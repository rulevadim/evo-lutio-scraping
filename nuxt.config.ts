import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-01',
  devtools: { enabled: true },

  // UnoCSS подключён вторым движком утилит — «поиграться потом».
  // Основная вёрстка ведётся на Tailwind (см. app/assets/css/main.css).
  modules: ['@unocss/nuxt'],

  css: ['~/assets/css/main.css'],

  // Секреты только на сервере (в publicRuntimeConfig их быть не должно).
  // Значения приходят из env: NUXT_ADMIN_PASSWORD и NUXT_SESSION_PASSWORD.
  // Пустые по умолчанию = вход не настроен = скрейпинг закрыт наглухо.
  runtimeConfig: {
    adminPassword: '',
    sessionPassword: '',
  },

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
