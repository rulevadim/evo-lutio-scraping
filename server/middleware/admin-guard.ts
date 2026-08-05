import { isGuarded } from '~~/server/utils/guarded-routes'
import { isAdmin } from '~~/server/utils/session'

// Единственная точка контроля доступа. Middleware выполняется до любого
// роут-хендлера — это важно: четыре из пяти защищённых эндпоинтов отдают
// NDJSON-поток, и 401 должен уйти обычным JSON ДО того, как поток начался.
//
// Заодно кладёт `event.context.isAdmin` для КАЖДОГО запроса, включая SSR-рендер
// страницы: оттуда флаг попадёт во фронт без лишнего HTTP-запроса
// (см. app/plugins/admin.server.ts).

/**
 * Мутации разрешены только со своего сайта. `SameSite=Strict` на куке закрывает
 * основной CSRF-вектор, это второй слой на случай, если кука когда-нибудь
 * ослабнет.
 */
function originAllowed(event: Parameters<typeof isAdmin>[0]): boolean {
  const origin = getRequestHeader(event, 'origin')
  if (!origin) return true // не браузерный запрос (curl) — судим только по куке
  try {
    return new URL(origin).host === getRequestHost(event)
  } catch {
    return false
  }
}

export default defineEventHandler(async (event) => {
  // 1. Посчитать флаг. Без раннего return: иначе проверка ниже не выполнится
  //    и анонимный POST дошёл бы до скрейпера.
  event.context.isAdmin = await isAdmin(event)

  // 2. Закрыть защищённые пути — отдельным шагом, всегда.
  if (!isGuarded(event.path, event.method)) return

  // Текст для пользователя собирает фронт по коду статуса (useAdmin.handleError),
  // поэтому здесь короткие стандартные statusMessage.
  if (!event.context.isAdmin) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  if (!originAllowed(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
})
