import { createHash, timingSafeEqual } from 'node:crypto'
import type { H3Event, SessionConfig } from 'h3'

// Админ-сессия: один пароль из env + подписанная httpOnly-кука (штатный механизм
// h3, новых зависимостей не нужно).

const COOKIE_NAME = 'evo_admin'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // неделя
/** Пароль длиннее этого заведомо не наш — не хешируем что попало. */
const MAX_PASSWORD_LENGTH = 512
/** Короче 32 символов h3 не примет, да и незачем. */
const MIN_SECRET_LENGTH = 32

interface AdminSession {
  admin?: boolean
}

function sessionConfig(event: H3Event): SessionConfig {
  const { sessionPassword } = useRuntimeConfig(event)
  return {
    name: COOKIE_NAME,
    password: String(sessionPassword),
    maxAge: MAX_AGE_SECONDS,
    // Иначе h3 примет сессию ещё и из заголовка `x-evo_admin-session`.
    sessionHeader: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      // На локальном HTTP secure-кука не сохранилась бы вовсе.
      secure: !import.meta.dev,
      path: '/',
    },
  }
}

/**
 * Настроен ли вход вообще. Пустой пароль означает «скрейпинг закрыт», а не
 * «открыт всем»: ошибка конфигурации не должна разблокировать эндпоинты.
 */
export function adminConfigured(event: H3Event): boolean {
  const { adminPassword, sessionPassword } = useRuntimeConfig(event)
  return Boolean(adminPassword) && String(sessionPassword).length >= MIN_SECRET_LENGTH
}

function passwordMatches(input: string, expected: string): boolean {
  // Оба дайджеста по 32 байта, поэтому timingSafeEqual не бросит на разной длине.
  const a = createHash('sha256').update(input.slice(0, MAX_PASSWORD_LENGTH)).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/**
 * Проверить, админ ли это. Строго на чтение: сессия НЕ создаётся.
 *
 * Важно, что здесь `unsealSession`, а не `useSession`. У h3 `getSession` при
 * отсутствии куки заводит новую сессию, ставит её и падает при пустом пароле —
 * в глобальном middleware это выдавало бы куку каждому анонимному читателю и
 * роняло публичные страницы, когда пароль не задан.
 */
export async function isAdmin(event: H3Event): Promise<boolean> {
  const sealed = getCookie(event, COOKIE_NAME)
  if (!sealed) return false
  if (!adminConfigured(event)) return false
  try {
    // Здесь же проверяется срок жизни: просроченная кука бросает исключение.
    const unsealed = await unsealSession(event, sessionConfig(event), sealed)
    return (unsealed.data as AdminSession | undefined)?.admin === true
  } catch {
    return false // битая, подделанная или просроченная кука
  }
}

/** Проверить пароль и выдать сессию. `false` — пароль не подошёл либо вход не настроен. */
export async function loginAdmin(event: H3Event, password: string): Promise<boolean> {
  if (!adminConfigured(event)) return false
  const { adminPassword } = useRuntimeConfig(event)
  if (!passwordMatches(password, String(adminPassword))) return false

  const session = await useSession<AdminSession>(event, sessionConfig(event))
  await session.update({ admin: true })
  return true
}

export async function logoutAdmin(event: H3Event): Promise<void> {
  await clearSession(event, sessionConfig(event))
}
