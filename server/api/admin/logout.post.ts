import { logoutAdmin } from '~~/server/utils/session'

// POST /api/admin/logout — сбросить админ-сессию.
export default defineEventHandler(async (event) => {
  await logoutAdmin(event)
  return { isAdmin: false }
})
