import { clientIp, rateLimited } from '~~/server/utils/rate-limit'
import { adminConfigured, loginAdmin } from '~~/server/utils/session'

// POST /api/admin/login { password } — выдать админ-сессию.

/** Перебор пароля не должен быть бесплатным. */
const MAX_ATTEMPTS = 10
const WINDOW_MS = 60_000

export default defineEventHandler(async (event) => {
  // Текст для пользователя собирает фронт по коду статуса (useAdmin.handleError).
  if (rateLimited(`login:${clientIp(event)}`, MAX_ATTEMPTS, WINDOW_MS)) {
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  if (!adminConfigured(event)) {
    // Пароль не задан — вход невозможен в принципе, и это не ошибка клиента.
    throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' })
  }

  const body = await readBody<{ password?: unknown }>(event).catch(() => ({}))
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!password) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })

  if (!(await loginAdmin(event, password))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  return { isAdmin: true }
})
