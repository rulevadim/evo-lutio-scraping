import { describe, expect, it } from 'vitest'
import { isGuarded } from './guarded-routes'

describe('isGuarded', () => {
  it.each([
    ['/api/scrape', 'POST'],
    ['/api/scrape/more', 'POST'],
    ['/api/scrape/newer', 'POST'],
    ['/api/scrape/missing', 'POST'],
    ['/api/blog-stats', 'POST'],
  ])('закрывает %s %s', (path, method) => {
    expect(isGuarded(path, method)).toBe(true)
  })

  it('закрывает скрейп независимо от метода', () => {
    // Чтобы случайно добавленный GET-вариант эндпоинта не оказался открытым.
    expect(isGuarded('/api/scrape', 'GET')).toBe(true)
  })

  it('оставляет открытым GET /api/blog-stats', () => {
    // Счётчик в шапке виден анонимам — это осознанно.
    expect(isGuarded('/api/blog-stats', 'GET')).toBe(false)
  })

  it.each([
    ['/api/posts', 'GET'],
    ['/api/posts/123', 'GET'],
    ['/api/posts/123/comments', 'GET'],
    ['/api/search', 'GET'],
    ['/api/healthz', 'GET'],
    ['/api/admin/login', 'POST'],
    ['/api/admin/me', 'GET'],
    ['/', 'GET'],
  ])('оставляет открытым %s %s', (path, method) => {
    expect(isGuarded(path, method)).toBe(false)
  })

  it('не обманывается query-строкой', () => {
    expect(isGuarded('/api/scrape?x=1', 'POST')).toBe(true)
    expect(isGuarded('/api/blog-stats?x=1', 'POST')).toBe(true)
    expect(isGuarded('/api/blog-stats?x=1', 'GET')).toBe(false)
  })

  it('не ловит посторонние пути с похожим префиксом', () => {
    expect(isGuarded('/api/scrape-foo', 'POST')).toBe(false)
  })
})
