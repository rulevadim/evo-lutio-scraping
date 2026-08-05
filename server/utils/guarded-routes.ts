/**
 * Какие маршруты закрыты админ-доступом.
 *
 * Отдельным модулем, а не внутри middleware: это чистая функция без завязки на
 * h3-контекст, и её можно (и нужно) покрыть тестами — именно она решает, что
 * останется открытым публике.
 */
export function isGuarded(path: string, method: string): boolean {
  const route = path.split('?')[0]!
  // Скрейпинг — целиком.
  if (route === '/api/scrape' || route.startsWith('/api/scrape/')) return true
  // Пересчёт числа постов: ~150 запросов к ЖЖ. GET того же пути открыт всем —
  // счётчик в шапке виден анонимам.
  if (route === '/api/blog-stats' && method === 'POST') return true
  return false
}
