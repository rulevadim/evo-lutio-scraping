import { adminConfigured } from '~~/server/utils/session'

// GET /api/admin/me — актуальное состояние сессии.
//
// Нужен потому, что клиентский флаг протухает молча: кука истекла по maxAge либо
// выход сделан в другой вкладке. Фронт перепроверяет им состояние при возврате
// на вкладку.
export default defineEventHandler((event) => ({
  isAdmin: Boolean(event.context.isAdmin), // проставлен в middleware
  configured: adminConfigured(event),
}))
