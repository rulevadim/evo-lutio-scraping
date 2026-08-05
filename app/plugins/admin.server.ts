/**
 * Перенести серверный флаг админа в состояние Nuxt.
 *
 * `event.context.isAdmin` проставляет server/middleware/admin-guard.ts для каждого
 * запроса, включая SSR-рендер страницы. `useState` сериализуется в payload, поэтому
 * клиент поднимается ровно с тем значением, с которым рендерился сервер — никакого
 * hydration mismatch и никакого лишнего запроса к /api/admin/me на каждый рендер.
 */
export default defineNuxtPlugin(() => {
  const event = useRequestEvent()
  useState<boolean>('is-admin', () => Boolean(event?.context.isAdmin))
})
