import { adminErrorText, errorStatus, loginErrorText } from '~/utils/admin-errors'

/**
 * Состояние админ-доступа. Начальное значение приходит с сервера через
 * `app/plugins/admin.server.ts`, дальше меняется только входом/выходом и
 * перепроверкой через /api/admin/me.
 */
export function useAdmin() {
  const isAdmin = useState<boolean>('is-admin', () => false)

  async function login(password: string): Promise<void> {
    await $fetch('/api/admin/login', { method: 'POST', body: { password } })
    isAdmin.value = true
  }

  async function logout(): Promise<void> {
    await $fetch('/api/admin/logout', { method: 'POST' })
    isAdmin.value = false
  }

  /** Перепроверить сессию на сервере (кука могла истечь или выход сделан в другой вкладке). */
  async function refresh(): Promise<void> {
    try {
      const me = await $fetch<{ isAdmin: boolean }>('/api/admin/me')
      isAdmin.value = me.isAdmin
    } catch {
      isAdmin.value = false
    }
  }

  /**
   * Ошибка запроса от вошедшего админа. Сессия могла истечь молча — тогда
   * сбрасываем флаг, и кнопки исчезают сами.
   */
  function handleError(err: unknown): string {
    if (errorStatus(err) === 401) isAdmin.value = false
    return adminErrorText(err)
  }

  /** Ошибка формы входа: 401 здесь — неверный пароль, а не истёкшая сессия. */
  function handleLoginError(err: unknown): string {
    return loginErrorText(err)
  }

  return { isAdmin, login, logout, refresh, handleError, handleLoginError }
}
