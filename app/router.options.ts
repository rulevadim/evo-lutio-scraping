import type { RouterConfig } from '@nuxt/schema'

// Когда в URL есть ?q= (переход из поиска), скролл берёт на себя страница поста
// (центрирует найденное слово) — не даём роутеру прыгать к верху #-якоря.
export default <RouterConfig>{
  scrollBehavior(to, _from, savedPosition) {
    if (to.query.q) return false
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, top: 80 }
    return { top: 0 }
  },
}
