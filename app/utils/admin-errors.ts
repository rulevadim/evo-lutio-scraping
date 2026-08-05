// Тексты ошибок административных запросов.
//
// Вынесено из useAdmin отдельными чистыми функциями, чтобы их можно было
// проверить тестами: разница между «сессия истекла» и «неверный пароль» —
// это ровно тот случай, который на глаз не ловится.

/** Код статуса из ошибки `$fetch` либо брошенной вручную (readScrapeStream). */
export function errorStatus(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number } | null
  return e?.status ?? e?.statusCode
}

/**
 * Ошибка запроса от уже вошедшего админа (скрейп, пересчёт статистики).
 * Здесь 401 означает, что сессия перестала действовать.
 */
export function adminErrorText(err: unknown): string {
  switch (errorStatus(err)) {
    case 401:
      return 'Сессия истекла — войдите заново.'
    case 403:
      return 'Запрос отклонён: недопустимый источник.'
    case 409:
      return 'Другая задача уже выполняется — дождитесь её окончания.'
    case 429:
      return 'Слишком часто. Подождите минуту.'
    case 503:
      return 'Вход администратора не настроен на сервере.'
    default:
      return 'Не удалось выполнить. Попробуйте ещё раз.'
  }
}

/**
 * Ошибка формы входа. Отличается трактовкой 401: сессии ещё не было, значит
 * дело в пароле, а не в её истечении.
 */
export function loginErrorText(err: unknown): string {
  if (errorStatus(err) === 401) return 'Неверный пароль.'
  return adminErrorText(err)
}
